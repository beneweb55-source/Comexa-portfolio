# Vocaux Telegram et passerelle WhatsApp

Deux fonctionnalités, un même principe : **le bot reste dans n8n**, le backend
n'expose que des routes HTTP. Ce document décrit ce qui est livré, ce qu'il faut
configurer, et — pour WhatsApp — ce que cela coûte en risque.

Les routes, leurs champs et leurs codes d'erreur sont dans
[`docs/API-N8N.md`](API-N8N.md) §10. Ici : l'architecture et les décisions.

---

## 1. Vocaux Telegram

### 1.1 Ce qui est demandé

Le bot `@ComexaWork_bot` doit comprendre les messages vocaux : un membre dicte une
tâche, un devis, une remarque, et le workflow agit.

### 1.2 Pourquoi un moteur externe

Telegram n'offre **aucune** transcription par l'API Bot. `messages.transcribe`
existe, mais il est réservé au protocole MTProto et répond
`PREMIUM_ACCOUNT_REQUIRED` — un jeton de bot ne peut pas l'appeler. Il faut donc
un moteur de reconnaissance vocale extérieur, quel que soit le choix retenu.

### 1.3 Le découpage retenu

```
Telegram ──update──▶ n8n ──getFile + téléchargement──▶ octets
                                                          │
                                     POST /api/v1/integrations/telegram/transcribe
                                                          │
                                                    backend NestJS
                                                          │
                                            POST {base}/audio/transcriptions
                                                          │
                                              Groq / OpenAI / Whisper local
```

Le backend **ne parle jamais à Telegram**. Il reçoit des octets et rend du texte.
Deux conséquences utiles :

- la route se teste avec `curl`, sans compte Telegram ;
- le rythme, les reprises et les notifications d'échec restent dans n8n, comme
  pour tout le reste du bot.

### 1.4 Un seul pilote, plusieurs fournisseurs

L'API `/audio/transcriptions` d'OpenAI est devenue une forme commune : Groq,
OpenAI, Mistral et un serveur `faster-whisper` auto-hébergé la servent tous.
Changer de fournisseur est donc **une URL**, pas une dépendance ni du code à
réécrire (`TRANSCRIPTION_PROVIDER=openai-compatible` + `TRANSCRIPTION_BASE_URL`).

### 1.5 Aucun ffmpeg

Un vocal Telegram est de l'Opus dans un conteneur OGG — et c'est un format que ces
moteurs acceptent directement. Ajouter une conversion aurait imposé un binaire
système dans l'image Docker, un point de panne et du temps de calcul, pour rendre
un fichier que le destinataire sait déjà lire. La liste des formats transmis est
bornée (`ACCEPTED_AUDIO_MIME_TYPES`) : ce qui n'y est pas est refusé **avant**
l'appel, donc avant d'être facturé.

### 1.6 Aucun octet audio conservé

`voice_transcripts` ne contient que du texte. Le buffer transmis au moteur est
oublié dès la réponse : ni en base, ni dans MinIO, ni sur disque. Un vocal est une
donnée personnelle captée dans un lieu privé ; le conserver au-delà de la
transcription n'aurait aucun fondement, et un stock d'audio serait la première
chose emportée en cas de fuite.

Le **texte** est conservé — le bot doit pouvoir s'y référer — pour une durée
bornée : `TRANSCRIPT_RETENTION_DAYS` (30 par défaut, `0` = sans limite) et une
purge planifiée chaque nuit (`@Cron`, 3 h).

### 1.7 Le rejeu

`telegramFileId` est unique en base. Un workflow n8n rejoue un nœud HTTP dont la
réponse a expiré ; sans cette clé, le même vocal serait transcrit deux fois — donc
payé deux fois, et rendu sous deux identifiants différents, ce qui ferait deux
réponses différentes à une même question. La réponse porte alors `replayed: true`.

La vérification a lieu **avant** l'appel au moteur, et la contrainte d'unicité
couvre deux requêtes simultanées : la perdante relit la ligne de la gagnante au
lieu de renvoyer une erreur.

### 1.8 Configurer

```dotenv
TRANSCRIPTION_PROVIDER=openai-compatible
TRANSCRIPTION_BASE_URL=https://api.groq.com/openai/v1
TRANSCRIPTION_API_KEY=gsk_…
TRANSCRIPTION_MODEL=whisper-large-v3-turbo
TRANSCRIPTION_LANGUAGE=            # vide = le moteur détecte
TRANSCRIPTION_PROMPT=Comexa, devis, facture
TRANSCRIPT_RETENTION_DAYS=30
```

`TRANSCRIPTION_LANGUAGE` vide est le choix utile : sur une équipe qui parle
français **et** arabe, imposer `fr` ferait transcrire un vocal arabe n'importe
comment, sans aucune erreur nulle part.

Sans moteur (`TRANSCRIPTION_PROVIDER=none`), le backend démarre normalement et la
route répond `503 TRANSCRIPTION_NOT_CONFIGURED` avec la marche à suivre.

### 1.9 Les statuts d'erreur, et pourquoi ils surprennent

| Code | HTTP | Pourquoi ce statut |
|---|---|---|
| `TRANSCRIPTION_NOT_CONFIGURED` | 503 | aucune route ne peut aboutir |
| `TRANSCRIPTION_AUDIO_REQUIRED` | 400 | le champ `file` manque |
| `TRANSCRIPTION_UNSUPPORTED_FORMAT` | 422 | ce n'est pas de l'audio reconnu |
| `TRANSCRIPTION_PAYLOAD_TOO_LARGE` | 413 | au-dessus de `TRANSCRIPTION_MAX_BYTES` |
| `TRANSCRIPTION_UNAUTHORIZED` | **502** | la clé refusée est **la nôtre** : un 401 dirait au workflow que *son* jeton est mauvais, et n8n irait renouveler un jeton parfaitement valide |
| `TRANSCRIPTION_RATE_LIMITED` | **503** | le fournisseur est saturé, pas l'appelant : 429 annoncerait un débit dépassé par le workflow |
| `TRANSCRIPTION_UPSTREAM_UNREACHABLE` | 503 | délai dépassé ou moteur injoignable |
| `TRANSCRIPTION_UPSTREAM_FAILED` | 502 | le moteur a répondu, en erreur ou sans texte exploitable |

Un `200` sans texte est traité comme un **échec** : un texte vide ressemble à la
transcription réussie d'un silence, et le workflow créerait une tâche vide sans
qu'aucune erreur ne soit levée.

---

## 2. WhatsApp

### 2.1 Ce qui est demandé

Envoyer des messages aux contacts d'un membre **depuis son propre compte
WhatsApp**, à la demande — ou depuis le compte d'un tiers qui l'y autorise, avec
son consentement explicite.

### 2.2 L'état réel des APIs WhatsApp

| Voie | Compte personnel | Répertoire | Messages libres | Risque |
|---|---|---|---|---|
| **Business Cloud API** (officielle) | non — numéro d'entreprise dédié | non | non : modèles pré-approuvés hors de la fenêtre de 24 h | aucun |
| **Passerelle multidevice** (WAHA, Evolution) | oui | oui | oui | **suspension définitive du numéro** |
| Twilio / 360dialog / CallMeBot | non | non | mêmes limites que l'officielle | aucun, mais payant |

Aucune API officielle ne donne accès à un compte personnel ni à son carnet
d'adresses. Le besoin tel qu'il est formulé — *le compte de la personne, ses
contacts* — n'est donc atteignable que par une passerelle qui tient une session
multidevice, exactement comme WhatsApp Web le fait.

**C'est contraire aux conditions d'utilisation de WhatsApp**, et cela peut coûter
le numéro définitivement. Ce n'est pas un détail d'implémentation : c'est écrit
dans le texte de consentement montré au titulaire, et c'est la raison des
garde-fous ci-dessous.

### 2.3 L'architecture

```
                       ┌──────────────────────────────┐
n8n (bot) ──HTTP──▶    │  backend NestJS              │
                       │  consentement, règle d'envoi │──HTTP──▶ WAHA / Evolution
application web ──▶    │  journal, répertoire         │              │
                       └──────────────────────────────┘        session multidevice
                                                                     │
                                                              téléphone du titulaire
```

Le backend héberge le service passerelle ; n8n ne fait que l'appeler. Deux
pilotes sont implémentés, sélectionnés par `WHATSAPP_GATEWAY_DRIVER` :

| Pilote | Forme | Remarque |
|---|---|---|
| `waha` | **une** instance tient plusieurs sessions | la forme du besoin : un membre (ou un tiers) = une session |
| `evolution` | une **instance par** compte | un conteneur par numéro |
| `none` | aucun | les routes existent et répondent `503` avec un code stable |

WAHA Core est gratuit ; sa route de répertoire (`/api/contacts/all`) fait partie
de WAHA **PLUS**. Sans cette licence, les envois vers un numéro connu restent
possibles et la lecture du répertoire répond `WHATSAPP_FEATURE_UNAVAILABLE` —
jamais une liste vide, qui ferait croire que le compte n'a aucun contact.

Déploiement local : `COMEXA_WHATSAPP_DRIVER=waha docker compose --profile gateway up --build`
(service `waha` de `backend/docker-compose.yml`, **port non publié**, volume
`comexa_waha` pour les identifiants d'appairage — le perdre, c'est rescanner un QR
sur chaque téléphone).

### 2.4 Le consentement

Rien ne se connecte sans un consentement **versionné, daté et révocable**.

- `CONSENT_VERSION` (`2026-10-15.1`) est stockée avec l'acceptation. Changer le
  texte sans changer la version serait mentir sur ce que les gens ont accepté ;
  changer la version rend les consentements antérieurs `CONSENT_OUTDATED`, donc
  inutilisables jusqu'à une nouvelle acceptation.
- Le texte **nomme** le demandeur, les capacités accordées, le plafond horaire, le
  fait que les messages partent du numéro du titulaire, et le risque de
  suspension. Il est rendu par `GET /api/me/whatsapp/consent` avant tout appairage.
- Deux capacités existent : `message:send` (accordée par défaut) et
  `contact:read`. La seconde **copie le répertoire** — des données de personnes qui
  n'ont rien demandé — et n'est jamais implicite.
- La révocation est immédiate et complète : session coupée côté passerelle,
  contacts copiés **supprimés**, adresse IP du consentement effacée. Elle aboutit
  même si la passerelle ne répond pas.

### 2.5 Autoriser un tiers

Un membre peut demander à utiliser le compte d'une autre personne :

```
POST /api/whatsapp/delegations  →  code WA-XXXX-XXXX-XXXX (rendu UNE fois)
                                   + courriel au tiers (texte de consentement)
                                   + lien https://t.me/ComexaWork_bot?start=wa_…
        │
        ▼   le tiers, dans Telegram
/autoriser WA-7KQM-2ZPX-9BRT  →  POST /integrations/whatsapp/delegations/accept
                                   → QR à scanner depuis SON téléphone
/refuser   WA-7KQM-2ZPX-9BRT  →  POST /integrations/whatsapp/delegations/refuse
```

Trois propriétés, toutes délibérées :

- **seul le scan du titulaire termine l'appairage.** Comexa ne peut pas accepter à
  sa place : c'est la garantie que le numéro engagé est bien celui de la personne
  qui a accepté ;
- **le code n'est stocké que sous forme d'empreinte** SHA-256, comparée à durée
  constante. Il n'apparaît dans aucune autre réponse, jamais — y compris dans la
  liste des invitations, que l'administration peut lire ;
- **un message identique** est rendu pour un code absent, déjà utilisé ou expiré.
  Distinguer les trois serait un oracle : il permettrait d'énumérer les codes
  valides.

Le code expire (`WHATSAPP_DELEGATION_CODE_TTL`, 72 h par défaut). Son alphabet
exclut `0`/`O` et `1`/`I` : il est recopié à la main depuis un courriel.

### 2.6 Les garde-fous à l'envoi

La règle (`evaluateSendPolicy`) s'applique **avant** tout appel à la passerelle,
dans cet ordre — l'ordre est celui de l'explication :

1. compte révoqué ;
2. consentement (retiré → manquant → expiré → obsolète) ;
3. capacité `message:send` accordée ;
4. session appairée (`CONNECTED`) ;
5. destinataire lisible ;
6. **groupes refusés** — un message de groupe touche tous ses membres, ce qui
   dépasse l'autorisation donnée pour des contacts individuels ;
7. corps non vide, ≤ `WHATSAPP_MAX_BODY_LENGTH` (refusé, **jamais tronqué** :
   tronquer changerait le sens sans que le destinataire le voie) ;
8. plafond horaire **en dernier** — annoncé sur un envoi qui serait de toute façon
   refusé, il ferait attendre une heure pour rien.

À quoi s'ajoutent :

- **numéros ambigus refusés.** `555123456` (ni `+`, ni `00`, ni `0` initial, et ne
  commençant pas par l'indicatif par défaut) n'est pas deviné : préfixer au hasard
  enverrait le message d'un client à un inconnu ;
- **jOURNAL de chaque envoi**, écrit **avant** l'appel à la passerelle (`QUEUED`,
  puis `SENT`/`FAILED`/`REFUSED`). Écrire après le succès produirait l'inverse de
  ce qu'un journal existe pour empêcher : des envois réels sans aucune trace ;
- **idempotence par compte** : `(accountId, idempotencyKey)` est unique, donc un
  rejeu de workflow ne renvoie pas deux fois le même message à un client ;
- **noms de session aléatoires** (`comexa-<aléa>`), jamais dérivés d'un
  identifiant de membre : ils apparaissent dans les journaux de la passerelle, qui
  est un service distinct.

### 2.7 Le répertoire

Lire les contacts **copie les données de personnes qui n'ont rien demandé**. D'où :

- la synchronisation exige la capacité `contact:read`, accordée explicitement ;
- sans elle, la route répond `403 WHATSAPP_SCOPE_NOT_GRANTED` — pas une liste vide ;
- la copie est bornée (500 entrées par page, 8 pages maximum) ;
- supprimer-puis-recréer, et non fusionner : une fusion conserverait les contacts
  que le titulaire a effacés de son téléphone ;
- **tout est supprimé à la révocation**, dans la même transaction que le passage à
  `REVOKED`.

### 2.8 Ce qui n'est pas livré

- **aucune interface web** pour l'appairage : le QR est affiché dans Telegram par
  le bot. Les routes `/api/me/whatsapp/*` existent et sont documentées, mais aucune
  page ne les appelle encore — d'où l'absence de `whatsappGateway` dans
  `REQUIRED_FEATURES` du miroir frontend (`src/lib/contract.js`) ;
- **aucune lecture des conversations** : seule la route d'envoi existe. Rien ne
  reçoit, n'écoute ni n'archive les messages arrivés ;
- **aucun envoi vers des groupes**, à quelque niveau que ce soit ;
- **aucun client Telegram dans le backend** : le bot reste dans n8n.

### 2.9 Configurer

```dotenv
WHATSAPP_GATEWAY_DRIVER=waha        # none | waha | evolution
WHATSAPP_GATEWAY_URL=http://waha:3000
WHATSAPP_GATEWAY_API_KEY=…
WHATSAPP_MAX_MESSAGES_PER_HOUR=40
WHATSAPP_MAX_BODY_LENGTH=1024
WHATSAPP_DELEGATION_CODE_TTL=72h
WHATSAPP_CONSENT_TTL=               # vide = aucune échéance
WHATSAPP_DEFAULT_COUNTRY_CODE=DZ
TELEGRAM_BOT_USERNAME=ComexaWork_bot
```

`WHATSAPP_GATEWAY_URL` et `WHATSAPP_GATEWAY_API_KEY` sont **obligatoires** dès que
le pilote n'est pas `none` : le serveur refuse de démarrer sinon. Une passerelle
mal configurée ne se voit qu'au premier envoi — donc chez un client. En
production, une URL en `http://` est refusée, sauf vers un hôte interne.

### 2.10 Si le risque n'est pas acceptable

La voie officielle reste possible, avec ses limites : un numéro d'entreprise
dédié, des modèles pré-approuvés pour tout message hors de la fenêtre de 24 h, et
aucun accès au carnet d'adresses. Le code ne l'implémente pas — `none` répond 503,
et rien n'empêche d'ajouter un pilote officiel derrière la même interface
`WhatsAppGateway`, qui ne dépend d'aucun des deux pilotes existants.

---

## 3. Modèle de données

Migration `20261015000000_voice_and_whatsapp`.

| Table | Rôle | Ce qu'il faut en retenir |
|---|---|---|
| `voice_transcripts` | texte des vocaux | `telegramFileId` **unique** = clé de rejeu ; aucun octet audio |
| `whatsapp_accounts` | un compte appairé | `sessionName` unique ; état, consentement (version, date, IP, échéance), capacités accordées |
| `whatsapp_delegations` | une invitation à un tiers | code sous **empreinte** unique ; capacités demandées ; échéance du code |
| `whatsapp_contacts` | copie du répertoire | unique par `(accountId, jid)` ; supprimée à la révocation |
| `whatsapp_messages` | journal des envois | unique par `(accountId, idempotencyKey)` ; `SENT` exige `sentAt` ; ligne écrite **avant** l'appel |

Permissions ajoutées au catalogue : `telegram:transcribe:any`,
`whatsapp:link:any`, `whatsapp:send:any`, `whatsapp:read:any`,
`whatsapp:delegate:any`, `whatsapp:manage:any`. Le rôle
`COMMUNICATION_MANAGER` reçoit `whatsapp:delegate:any` et `whatsapp:read:any` —
**pas** `whatsapp:send:any`, qui reste à accorder explicitement.

---

## 4. Vérifier

```bash
cd backend
npm test                       # règles pures : identité, consentement, règle d'envoi, pilotes
npx tsc -p tsconfig.json --noEmit
npm run lint
```

Les pilotes de passerelle et le moteur de transcription sont testés avec un
`fetch` **injecté** : aucune passerelle, aucun fournisseur, aucun réseau. Ce qui
est vérifié n'est pas « WAHA répond ceci » mais « quelle que soit sa réponse, quel
code et quel message produisons-nous ».

---

## 5. Ce qui reste à faire côté hébergement

1. **Appliquer la migration** (`prisma migrate deploy` au démarrage, ou
   `npm run prisma:deploy`).
2. **Renseigner** `TRANSCRIPTION_*` (clé Groq ou OpenAI) si les vocaux doivent
   fonctionner.
3. **Décider** pour WhatsApp : laisser `WHATSAPP_GATEWAY_DRIVER=none`, ou déployer
   une passerelle en connaissance du risque de suspension (§2.2).
4. **Donner les scopes** au jeton n8n (§10 de `docs/API-N8N.md`) — de préférence
   deux jetons distincts, l'un pour envoyer, l'autre pour lire.
5. **Régénérer** `shared/api/openapi.json` depuis un poste disposant d'une base :
   `npm run openapi:export`.
