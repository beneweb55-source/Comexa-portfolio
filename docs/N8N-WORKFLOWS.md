# Workflows n8n — vocaux Telegram et WhatsApp

Le bot vit dans n8n : le backend expose des routes, il n'héberge aucun bot. Ce
document explique comment importer et câbler le workflow fourni, commande par
commande, et quoi faire quand une réponse ne ressemble pas à ce qui est écrit ici.

- Contrat des routes : [`docs/API-N8N.md`](./API-N8N.md) (§10 pour vocaux et WhatsApp)
- Architecture, consentement, garde-fous : [`docs/TELEGRAM-VOIX-WHATSAPP.md`](./TELEGRAM-VOIX-WHATSAPP.md)
- Fichier à importer : [`integrations/n8n/comexa-bot-telegram.json`](../integrations/n8n/comexa-bot-telegram.json)

---

## 1. Un seul workflow, et ce n'est pas un choix esthétique

**Telegram n'autorise qu'un webhook par bot.** Deux workflows contenant chacun un
déclencheur Telegram ne peuvent pas être actifs en même temps : le second
`setWebhook` écrase le premier, et les messages partent alors vers un workflow
dont l'autre moitié est éteinte — sans erreur visible nulle part.

Le fichier fourni contient donc **un seul déclencheur** qui route les vocaux et
les commandes. Si vous préférez séparer, la bonne découpe est :

- un workflow *déclencheur* qui garde l'unique webhook et appelle les autres ;
- des workflows *métier* démarrés par un nœud **Execute Sub-workflow**, jamais par
  un second déclencheur Telegram.

Les nœuds sont regroupés par zones, avec des notes collantes : vocaux, commandes
du membre, consentement d'un tiers, erreurs.

---

## 2. Prérequis

### 2.1 Variables n8n

Réglages → Variables. **Rien n'est écrit en dur dans un nœud** : une URL ou un
jeton recopié dans dix nœuds est un secret qui fuit dans un export.

| Variable | Exemple | Rôle |
|---|---|---|
| `COMEXA_API_BASE` | `https://comexa-api.onrender.com` | base de l'API, **sans** `/api` ni `/` final |
| `TELEGRAM_BOT_TOKEN` | `123456:ABC-…` | token BotFather du bot |

Pourquoi le token est une variable alors qu'il est déjà dans un credential :
`N8N_BLOCK_ENV_ACCESS_IN_NODE` bloque `$env`, et **n8n n'expose pas la valeur d'un
credential aux expressions**. Or `getFile`, `sendPhoto` et `sendMessage` portent le
token dans l'URL — impossible de le sortir du credential. D'où une variable pour
les appels Telegram, et un credential pour les appels Comexa (qui, eux, passent par
l'en-tête `Authorization`).

### 2.2 Credentials

| Credential | Où le sélectionner | Contenu |
|---|---|---|
| **Header Auth** (`Comexa API`) | tous les nœuds HTTP qui appellent Comexa | `Authorization` = `Bearer cxi_…` |
| **Telegram API** | le déclencheur uniquement | le même token |

Le fichier exporté ne contient **aucun bloc `credentials`** : c'est volontaire. Un
identifiant de credential n'a de sens que sur votre instance, et l'import échouerait
au lieu de vous demander de le resélectionner. À l'import, chaque nœud concerné
affiche un triangle : sélectionnez le credential, c'est tout.

### 2.3 Jeton d'intégration et périmètre

Créez le jeton (voir `docs/API-N8N.md` §2), puis n'accordez **que** ce dont le
workflow se sert :

| Scope | Utilisé par |
|---|---|
| `telegram:transcribe:any` | transcription des vocaux |
| `telegram:link:any` | résolution Telegram → membre |
| `whatsapp:link:any` | appairage, statut, révocation, consentement et acceptation d'un tiers |
| `whatsapp:send:any` | `/envoyer` |
| `whatsapp:read:any` | `/contacts`, journal des envois |

Retirer `whatsapp:send:any` suffit à rendre l'envoi impossible, côté serveur : le
workflow ne devient pas le seul rempart. C'est la raison pour laquelle la
suppression d'un projet **n'est pas** exposée ici — voir §7.

### 2.4 Côté backend

Le serveur doit démarrer avec la transcription et, pour WhatsApp, la passerelle
configurées (`TRANSCRIPTION_*`, `WHATSAPP_GATEWAY_*` — voir `backend/.env.example`).
Le démarrage **refuse** une passerelle déclarée sans URL ni clé : une mauvaise
configuration échoue au démarrage, pas au premier envoi à un client.

---

## 3. Import

1. n8n → **Workflows** → **⋯** → **Import from file** → `comexa-bot-telegram.json`.
2. Sélectionnez les deux credentials sur les nœuds signalés.
3. Renseignez `COMEXA_API_BASE` et `TELEGRAM_BOT_TOKEN` (§2.1).
4. Testez **sans activer** (§5).
5. Activez. L'activation enregistre le webhook Telegram : avant cela, le bot ne
   reçoit rien, et `/start` dans Telegram reste sans réponse.

---

## 4. Commandes

| Message | Ce que fait le bot | Route appelée |
|---|---|---|
| *un vocal* | télécharge l'audio, le transcrit, renvoie le texte | `POST …/telegram/transcribe` |
| `/whatsapp` | démarre l'appairage, affiche le QR et la marche à suivre | `POST …/whatsapp/users/{id}/session` |
| `/statut` | état, capacités accordées, validité du consentement | `GET …/users/{id}/session` |
| `/deconnecter` | révoque la session, supprime les contacts copiés | `DELETE …/users/{id}/session` |
| `/contacts` | répertoire en cache (si `contact:read` accordé) | `GET …/users/{id}/contacts?perPage=50` |
| `/envoyer +213555123456 votre message` | envoie **depuis votre compte WhatsApp** | `POST …/users/{id}/messages` |
| `/autoriser WA-XXXX-XXXX-XXXX` | affiche le texte de consentement, **n'enregistre rien** | `GET …/whatsapp/delegations/consent` |
| `/accepter WA-XXXX-XXXX-XXXX` | accepte, affiche le QR à scanner depuis le téléphone du tiers | `POST …/whatsapp/delegations/accept` |
| `/refuser WA-XXXX-XXXX-XXXX` | refuse, le code devient inutilisable | `POST …/whatsapp/delegations/refuse` |
| `/aide`, ou commande inconnue | liste des commandes | — |

`/autoriser` puis `/accepter`, **deux commandes** : `accept` exige
`acceptConsent: true`, donc accepter dès la réception du code enregistrerait un
consentement que personne n'a encore lu. La route de lecture ne crée aucun compte
et n'écrit rien ; elle rend le **même** texte que celui renvoyé par `accept`, et
**exactement la même erreur** qu'elle pour un code absent, déjà utilisé ou expiré
(ne pas permettre d'énumérer les codes valides).

---

## 5. Procédure de test

Chaque étape a une réponse attendue. Si elle diffère, le §6 donne la cause.

1. **`/aide`** → la liste des commandes s'affiche. Ne touche aucune route : si ça
   échoue, le problème est le token ou le webhook, pas le backend.
2. **Un vocal de 5 secondes** → la transcription, avec la langue et le moteur.
   Renvoyez **le même vocal** : la réponse porte
   « déjà transcrit : aucun nouvel appel au moteur ». C'est `telegramFileId` qui
   sert de clé de rejeu — un retry n8n ne paie pas deux fois.
3. **`/statut` sans appairage** → `WHATSAPP_ACCOUNT_NOT_FOUND`, traduit en
   « Aucun compte WhatsApp actif : /whatsapp pour l'appairer. »
4. **`/whatsapp`** → un QR en image, puis la marche à suivre et le texte de
   consentement. Scannez depuis WhatsApp → Appareils connectés.
5. **`/statut`** → `CONNECTED`, vos capacités, et la date d'expiration du
   consentement.
6. **`/contacts`** → le répertoire en cache. `WHATSAPP_SCOPE_NOT_GRANTED` si le
   titulaire n'a pas accordé `contact:read` : c'est le comportement attendu, pas un
   bogue.
7. **`/envoyer <votre second numéro> test`** → `SENT`. Vérifiez la réception sur
   l'autre téléphone. Renvoyez **exactement** le même `/envoyer` : la réponse porte
   « déjà envoyé : ce rejeu n'a rien transmis de plus » (clé d'idempotence
   `tg-<chatId>-<messageId>`).
8. **`/envoyer 123`** (sans texte) → le bot redonne le format attendu, sans appel
   au backend.
9. **`/deconnecter`** → confirmation de révocation, puis `/contacts` renvoie
   `WHATSAPP_ACCOUNT_NOT_FOUND`.
10. **Consentement d'un tiers** : créez une invitation depuis l'application web,
    envoyez le code à un autre compte Telegram. Sur ce compte : `/autoriser <code>`
    → le texte s'affiche ; `/accepter <code>` → le QR ; scan depuis **son**
    téléphone. `/refuser <code>` sur une autre invitation → « rien n'a été
    connecté ».
11. **Code inventé** : `/autoriser WA-0000-0000-0000` → « Code d'autorisation
    invalide, déjà utilisé ou expiré. » Un code mal recopié (`WA-12`) → le message
    sur la forme attendue.

Testez aussi **l'exécution en échec** : coupez `COMEXA_API_BASE` (mettez une URL
inexistante) et envoyez `/statut`. Le bot doit répondre un message lisible — pas
un silence, pas une trace d'appels empilée.

---

## 6. Erreurs et dépannage

Tous les nœuds HTTP appelant Comexa sont en **Continue (using error output)**, et
toutes ces sorties tombent dans un seul nœud *Normaliser erreur*, qui traduit le
code stable (`WHATSAPP_CONSENT_EXPIRED`, `TRANSCRIPTION_RATE_LIMITED`, …) en phrase
lisible. Les workflows branchent sur `error.code`, **jamais sur le message** : les
messages peuvent changer, les codes non.

| Symptôme | Cause probable |
|---|---|
| Aucune réponse à aucun message | workflow non activé, ou un **autre** workflow actif a pris le webhook du bot (§1) |
| `Variables n8n manquantes` | `COMEXA_API_BASE` / `TELEGRAM_BOT_TOKEN` non renseignées (§2.1) |
| 401 sur toutes les routes Comexa | credential Header Auth non sélectionné, ou jeton révoqué |
| `VALIDATION_ERROR` | un champ envoyé n'existe pas dans le DTO : le serveur est en `forbidNonWhitelisted`, **tout** champ inconnu est refusé |
| `Droit insuffisant : whatsapp:send` | scope manquant sur le jeton (§2.3) |
| `TRANSCRIPTION_NOT_CONFIGURED` | `TRANSCRIPTION_PROVIDER=none` côté serveur |
| `TRANSCRIPTION_UPSTREAM_UNREACHABLE` | le moteur (Groq/OpenAI) ne répond pas ; le nœud retente 2 fois |
| `WHATSAPP_GATEWAY_NOT_CONFIGURED` | `WHATSAPP_GATEWAY_DRIVER=none` côté serveur : l'appairage est impossible tant que la passerelle n'est pas déployée |
| `WHATSAPP_GATEWAY_UNREACHABLE` | passerelle démarrée mais injoignable depuis le backend (`WHATSAPP_GATEWAY_URL`) |
| QR absent après `/whatsapp` | session déjà appairée : le bot répond « Aucun QR à scanner » au lieu d'échouer |
| Photo vide sur Telegram | la sortie de *QR en image* n'est pas binaire : vérifiez que `data.qr.imageBase64` est non vide juste avant |
| `403 WHATSAPP_RATE_LIMITED` | plafond d'envois atteint (heure glissante) : le bot refuse, il ne met pas en file d'attente |

Deux pièges n8n spécifiques, déjà traités dans le workflow — à ne pas « simplifier » :

- **Un nœud HTTP remplace `$json` par la réponse.** Tout ce qui vient d'avant se
  lit avec `$('Analyse du message').item.json.…`. C'est pourquoi un seul nœud
  normalise l'update entrant, et pourquoi les réponses reprennent `chatId` et
  `botToken` depuis lui.
- **La forme de sortie du déclencheur Telegram varie** selon la version
  (`$json.message.*` ou `$json.*`). Le nœud *Analyse du message* accepte les deux ;
  sans lui, le workflow fonctionne sur votre instance et casse après une mise à
  jour.

---

## 7. Ce que le workflow ne fait volontairement pas

- **Supprimer un projet.** La route existe (`DELETE /api/v1/projects/{id}`,
  suppression logique + audit), mais un ordre vocal mal transcrit coûterait trop
  cher pour être exécuté sans confirmation humaine. Si vous l'ajoutez : la route
  exige `project:delete:any` **et** `project:write:any` — le 403 nomme
  `project:write`, ce qui est trompeur quand on n'a oublié que le second scope.
- **Écrire vers un groupe WhatsApp.** Les JID `@g.us` sont refusés côté serveur :
  un envoi de masse mal ciblé est irréversible.
- **Mettre en file d'attente.** Au plafond horaire, le bot répond « attends » :
  une file d'attente invisible ferait partir des messages que le pilote ne
  reconnaîtrait plus comme les siens.
- **Conserver l'audio.** Seule la transcription est stockée ; `telegramFileId` est
  gardé comme clé de rejeu, les octets jamais.

---

## 8. État de ce fichier, et ce qui est vérifié

Le JSON n'a **pas été exécuté dans n8n** : aucune instance n'était disponible pour
l'importer. Ce qui l'est, en revanche, ce sont les deux choses qui cassent sans
prévenir :

```bash
npm run test:n8n     # 44 tests, à la racine du dépôt
```

[`integrations/n8n/workflow.test.mjs`](../integrations/n8n/workflow.test.mjs)
vérifie d'abord la **structure** (noms de nœuds uniques et sans apostrophe, toute
expression `$('Nom')` visant un nœud qui existe, toute connexion aboutissant, aucun
nœud orphelin, un seul déclencheur, aucun bloc `credentials` figé, chaque appel à
Comexa portant le credential Header Auth **et** une sortie d'erreur, toutes les
sorties d'erreur convergeant vers la normalisation, les champs envoyés conformes aux
DTO — `forbidNonWhitelisted` refuse tout champ de trop).

Il exécute ensuite le corps de **chaque nœud Code** dans un bac à sable avec des
jeux de données réalistes : les deux formes que peut prendre la sortie du
déclencheur, le lien profond `/start wa_…`, une transcription en rejeu, une session
déjà appairée (donc sans QR), un consentement expiré, un répertoire vide, un
`/envoyer` mal formé, et six formes d'erreur différentes. Les chemins de données
sont donc épinglés au contrat du backend : si un présentateur renomme `pairing` ou
`meta.total`, un test casse ici au lieu d'un `undefined` dans un message envoyé à un
client.

Restent **non vérifiés**, faute d'instance : les paramètres propres à n8n
(`convertToFile`, `sendPhoto` en multipart) et le comportement réel du déclencheur.
Deux conséquences pratiques :

- les versions de nœuds indiquées (`switch` 3.2, `if` 2.2, `httpRequest` 4.2,
  `set` 3.4, `convertToFile` 1.1, `telegramTrigger` 1.1, `code` 2, `telegram` non
  utilisé) sont celles de n8n ≥ 1.60. Sur une instance plus ancienne, n8n propose
  une migration à l'import : acceptez-la, puis revérifiez *QR en image* et
  *Envoyer le QR*, les deux nœuds les plus sensibles aux changements de paramètres.
- si un nœud refuse d'importer, supprimez-le et recréez-le à la main : les
  connexions et les expressions des autres nœuds ne dépendent pas de son
  identifiant interne, seulement de son **nom** (d'où l'absence d'apostrophes dans
  les noms de nœuds — `$('Nom')` se casserait).

Les appels à l'API Telegram passent par des nœuds HTTP plutôt que par le nœud
Telegram : un seul mécanisme d'envoi pour tout le workflow, et aucune dépendance
aux paramètres `sendPhoto` du nœud Telegram, qui ont changé entre versions.

Le fichier JSON est la **source de vérité** : modifiez-le dans n8n, puis
réexportez-le ici. `npm run test:n8n` dira immédiatement si un renommage a cassé
une référence.
