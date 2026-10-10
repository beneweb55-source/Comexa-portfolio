# Rattachement d'un compte a un dossier client (`users.clientId`)

> **Fichier dedie, a fusionner dans `docs/API.md`.**
> Il n'a pas ete ecrit directement dans `docs/API.md` parce que ce fichier est
> modifie en parallele par un autre chantier (conversion d'une demande de contact
> en prospect) : deux ecritures concurrentes sur un fichier de 20 Ko se perdent
> silencieusement. Les sections ci-dessous sont redigees pour etre collees telles
> quelles dans `docs/API.md` — §3 « Utilisateurs » pour la description des deux
> routes, §4 « Autorisation » pour la doctrine de perimetre, et la table des
> codes d'erreur pour les trois codes introduits ou reutilises ici.

---

## 1. Le trou que ce champ ferme

Mesure de depart, sur le code livre :

    $ grep -rn "clientId" src/modules/users/
    (aucune occurrence)

La colonne existait pourtant en base (`users.clientId`), et **trois mecanismes de
perimetre la lisaient deja** :

| Lecteur | Ce qu'il en fait |
|---|---|
| `src/modules/clients/client-scope.ts` | `policy.clientId` **remplace** l'identifiant de l'URL dans le `where` Prisma |
| `src/modules/projects/project-scope.ts` | en tire `{ clientId }`, ou `MATCH_NOTHING` si le porteur n'en a pas |
| `src/modules/invoices/audience.ts` | `clientPortalUserIds` — la liste des **destinataires** des notifications de devis, de facture et de paiement |

Consequence mesuree : un compte de role `CLIENT` cree par `POST /users` naissait
**sans perimetre**. Il se connectait, et `client-scope.ts` lui refusait ensuite
toute lecture — un compte inutilisable pour la seule chose qu'il existe pour
faire. Le seul moyen de le rattacher etait une **ecriture directe en Prisma**,
c'est-a-dire un chemin qu'aucun appelant de l'API ne peut emprunter. Le parcours
d'audit de bout en bout avait du s'y resoudre pour ses deux comptes clients A et
B ; c'est ce raccourci que ce champ supprime du produit.

Le presentateur, lui, etait deja complet : `USER_SELECT`, `UserView` et
`presentUser` portaient `clientId` depuis le debut. Le trou etait exactement
dans le **DTO** et le **service**.

---

## 2. Le champ, et ses trois etats

| | |
|---|---|
| **Type** | `string \| null` (cuid d'un dossier client) |
| **Longueur** | 1 a 64 caracteres — meme borne que `messaging`, `prospects` et `clients` |
| **Normalisation** | `trim()` des espaces de bord ; `null` et `undefined` traversent **tels quels** |
| **Obligatoire ?** | non, aux deux routes |

`PATCH /api/users/:id` distingue **trois etats**, comme le projet le fait deja
pour `tasks/dto/task.dto.ts` :

| Corps envoye | Effet | Lecture du service |
|---|---|---|
| `clientId` **absent** | le rattachement n'est pas touche | `dto.clientId === undefined` |
| `"clientId": null` | le rattachement est **retire** | `dto.clientId === null` |
| `"clientId": "<cuid>"` | le compte est rattache a ce dossier | `dto.clientId !== undefined` |

Une **chaine vide** n'est ni l'un ni l'autre : c'est une faute de saisie, pas une
intention. `@MinLength(1)` la refuse en `400 VALIDATION_FAILED`, avec un message
qui nomme la valeur a utiliser pour detacher.

Cette distinction n'est pas une coquetterie de typage. Un champ qui vaudrait
`null` par defaut ne permettrait pas de dire « detache ce compte » : le seul
moyen de retirer un rattachement serait une route dediee — une operation de plus
a securiser, a auditer et a tester. Elle est portee par `@IsOptional()` (qui
laisse passer `null` **et** `undefined`) puis par le test `!== undefined` dans le
service. Le DTO transporte les deux valeurs ; le service decide ce que chacune
veut dire.

---

## 3. Les routes

### `POST /api/users` — creation

| | |
|---|---|
| **Permission** | `user:manage:any` (inchangee) |
| **Champ ajoute** | `clientId?` — facultatif |
| **Contrainte** | le compte doit porter le role `CLIENT` |
| **Reponse** | `201` avec `data.user.clientId` renseigne |

Le rattachement est **resolu avant toute ecriture** : dossier lu, role verifie,
droit du porteur controle. Une creation refusee ne laisse donc ni compte a moitie
pose, ni mot de passe hache pour rien.

Un compte `CLIENT` **sans** `clientId` reste possible, et c'est deliberé : le
dossier n'existe pas encore, c'est un etat de transition legitime. Il est
**inerte** — toutes les routes de l'espace client le refusent avec un message
explicite (« Ce compte client n'est rattache a aucun dossier : signalez-le a
l'agence. »). L'etat dangereux est l'inverse, et il est refuse en `422` (§5).

### `PATCH /api/users/:id` — modification

| | |
|---|---|
| **Permission** | `user:write:any` (inchangee) — **plus** `client:read:any` pour POSER un rattachement |
| **Etats** | absent / `null` / valeur (§2) |
| **Reponse** | `200` avec `data.user.clientId` a jour |

Poser un rattachement **differant** de la valeur en base exige, en plus de
`user:write:any`, que le porteur puisse **lire** le dossier vise. Reposer le meme
identifiant n'est pas une modification : rien n'est ecrit, et aucune ligne de
journal n'est produite — un `updatedAt` qui bouge sans modification rendrait les
pistes d'audit trompeuses.

Retirer un rattachement (`null`) n'exige que `user:write:any` : l'operation ne lit
aucun dossier, et l'etat qu'elle produit est inerte (§ ci-dessus).

### Le champ sort de l'API

`data.user.clientId` figure dans toutes les reponses qui rendent un compte —
`POST /users`, `GET /users/:id`, `PATCH /users/:id`, `GET /users`. Sans lui, le
frontend ne pourrait ni afficher ni modifier le rattachement : le champ serait
ecrivable mais invisible, donc ingerable. Il figure egalement dans
`GET /api/auth/me` et dans la reponse de connexion (`AuthProfile`), puisque le
perimetre est relu en base a chaque requete authentifiee.

---

## 4. Permissions et perimetre

Deux niveaux, et les deux sont necessaires.

**Niveau 1 — le garde de la route.** `user:manage:any` pour `POST /users`,
`user:write:any` pour `PATCH /users/:id`. Inchange : le rattachement n'est pas une
route a part, c'est un champ de ces deux operations.

**Niveau 2 — le service, pour les LIGNES.** Le rattachement n'est pas un champ de
profil ordinaire : il **deplace un perimetre**, donc il decide des donnees qu'un
compte pourra lire. Poser un rattachement exige donc, en plus, le droit de lire
le dossier vise. Ce controle est fait par `clientPerimeter(policy, 'client',
'read')` (`src/modules/clients/client-scope.ts`), qui exige `client:read:any` et
refuse en `403 FORBIDDEN` sinon.

**Etat du catalogue, dit franchement.** Aucun role ne detient aujourd'hui
`user:write:any` ou `user:manage:any` sans detenir `client:read:any` : seul
`ADMIN` a ces codes, et `ADMIN` vaut `'ALL'`. Cette couche est donc **verifiee,
pas supposee** — elle n'est simplement pas atteignable par un role reel, et
`RoleCode` etant une enumeration Prisma a sept valeurs fixes, aucun role sur
mesure ne peut la rendre atteignable. Elle est la pour rester vraie le jour ou le
catalogue accordera `user:manage:any` a un role commercial. Le test de bout en
bout la rend neanmoins exercable le temps d'un appel, en accordant puis en
retirant `user:write:any` au role `DEVELOPER` en base
(`test/identity.e2e-spec.ts`, « refuse un dossier inexistant, un compte non-CLIENT
et un porteur sans droit de lecture »).

### Isolation horizontale (exigence du cahier des charges)

> « Un client ne doit jamais pouvoir modifier l'ID d'un autre client dans une
> requete pour acceder a ses donnees. »

Le perimetre est pose **dans le `where` Prisma**, jamais dans un `if` apres
lecture : `clientPerimeter` remplace l'identifiant de l'URL par `policy.clientId`
pour un porteur du role `CLIENT`. L'identifiant demande n'atteint donc jamais la
requete SQL — un appel qui oublierait une verification n'aurait rien a oublier.

Consequence assumee : un dossier hors perimetre est **introuvable — `404`, jamais
`403`**. Un `403` distinct confirmerait l'existence de la ligne visee.

Le meme principe s'applique aux comptes. `GET /users/:id` accepte desormais
`user:read:own` en plus de `user:read:any` :

| Porteur | Cible | Resultat |
|---|---|---|
| `user:read:any` | n'importe quel compte | `200` |
| `user:read:own` | **son propre** compte | `200` |
| `user:read:own` | un autre compte | **`404 USER_NOT_FOUND`** — jamais `403` |
| `user:read:own` | `GET /users` (annuaire) | `403 FORBIDDEN` — le garde tranche avant le service |

`GET /users` reste ferme a `user:read:any` : « lire un compte » et « lister le
portefeuille de comptes » sont deux choses differentes, que le meme scope ne doit
pas confondre.

`PATCH /users/:id` reste a `user:write:any` seul : le catalogue ne porte **aucun**
`user:write:own`, et en inventer un ici serait creer un code de permission hors
catalogue. Un porteur `own` ne peut donc pas modifier le rattachement d'un autre
compte — il ne peut modifier aucun rattachement.

### Portee de l'interdiction d'acces horizontal sur ce champ

`user:read:own` **ouvre la lecture de son propre rattachement** et rien d'autre :
la comparaison `id !== policy.userId` est faite **avant** toute lecture, et rend un
`404`. Un porteur `own` ne peut ni lire ni ecrire le rattachement d'un autre
compte. Le cas « une requete vise un autre identifiant pour atteindre ses
donnees » est donc ferme, et ferme par un `404` — pas par un `403` qui
confirmerait l'existence du compte vise.

---

## 5. Coherence role / rattachement — la decision de conception

**Regle A — on ne rattache pas un dossier a un compte qui ne porte pas le role
`CLIENT`.** Refus `422 CLIENT_ROLE_REQUIRED`.

Justification, et elle est mesurable : `users.clientId` **n'est pas lu qu'avec le
role**. `clientPortalUserIds` (`src/modules/invoices/audience.ts`) filtre sur
`clientId`, `deletedAt` et `status` **uniquement** — jamais sur le role. Un
developpeur a qui l'on aurait pose un `clientId` par distraction recevrait donc,
en clair, les notifications commerciales du dossier : references de devis,
montants de factures, confirmations de paiement. Les deux autres lecteurs
(`client-scope.ts`, `project-scope.ts`) sont des perimetres de **lecture**, et le
role manquant fermerait chaque route ; celui-ci, non. C'est la fuite que la regle
ferme.

**Regle B — on ne retire pas le role `CLIENT` a un compte rattache.** Refus `422
CLIENT_SCOPE_STILL_ATTACHED`.

La meme situation incoherente se construirait par l'autre bout, en deux requetes :
`PATCH /users/:id/roles` puis la meme chose. Le refus est **prefere a un
detachement automatique**, et c'est un choix :

- retirer un role est une operation sur les **DROITS** ; effacer un rattachement
  est une operation sur le **PERIMETRE d'un dossier** ;
- les faire dans la meme requete rendrait la seconde invisible dans l'intention
  de la premiere — l'appelant qui change des roles ne s'attend pas a perdre un
  rattachement ;
- l'audit enregistrerait deux faits pour un seul geste.

Le chemin reste ouvert et **explicite** : `PATCH /users/:id` avec
`clientId: null`, puis le changement de roles. Le message d'erreur nomme ce
chemin, et le test de bout en bout verifie que ce chemin fonctionne — un message
d'erreur qui renverrait vers une operation elle-meme refusee serait pire qu'un
message muet.

**L'asymetrie est deliberee.** Un `CLIENT` **sans** rattachement est accepte (et
inerte) ; un rattachement **sans** le role `CLIENT` est refuse. La difference
n'est pas une incoherence : le premier etat ne donne acces a rien et se repare
d'un `PATCH`, le second donne acces a quelque chose et ne se voit pas.

---

## 6. Journal d'audit

La pose, la modification et le retrait du rattachement laissent chacun une ligne
**dediee** :

| | |
|---|---|
| **Action** | `USER_CLIENT_SCOPE_CHANGED` |
| **entityType / entityId** | `User` / l'identifiant du compte |
| **`before`** | `{ "clientId": <ancien \| null> }` |
| **`after`** | `{ "clientId": <nouveau \| null> }` |

Une action a part, et pas seulement un `before`/`after` de plus dans
`USER_UPDATED` : le journal doit repondre a « qui a rattache ce compte a ce
dossier, et quand ? » par un **filtre sur une action**, sans obliger a relire le
JSON de toutes les modifications de profil pour y retrouver une valeur.

    GET /api/audit-logs?action=USER_CLIENT_SCOPE_CHANGED&entityId=<id>

Le champ `clientId` figure **aussi** dans les faits de `USER_UPDATED`
(`{ email, firstName, lastName, phone, clientId }`). Sans cela, un `PATCH` qui ne
toucherait que le rattachement produirait une ligne `USER_UPDATED` dont l'avant et
l'apres seraient identiques — un journal qui ne dit rien.

Le champ n'est pas un secret, il n'est donc pas masque par `redact.ts` ; le
masquage reste applique a tout le reste.

---

## 7. Cas de refus

| Situation | Statut | Code | Origine |
|---|---|---|---|
| `clientId` sur un compte sans le role `CLIENT` | `422` | `CLIENT_ROLE_REQUIRED` | `assertClientScopeRequiresClientRole` |
| Retrait du role `CLIENT` sur un compte rattache | `422` | `CLIENT_SCOPE_STILL_ATTACHED` | `assertClientScopeDetachedBeforeRoleChange` |
| Dossier inexistant, supprime logiquement, ou hors perimetre du porteur | `404` | `CLIENT_NOT_FOUND` | `UserService.resolveClientScope` (code du module clients, reutilise tel quel) |
| Porteur sans `client:read:any` qui tente de POSER un rattachement | `403` | `FORBIDDEN` | `clientPerimeter` |
| Porteur sans `user:write:any` / `user:manage:any` | `403` | `FORBIDDEN` | `PermissionsGuard`, avant le service |
| `user:read:own` sur le compte d'un autre | `404` | `USER_NOT_FOUND` | `UserService.requireReadableUser` |
| `clientId` vide (`""`) ou plus long que 64 caracteres | `400` | `VALIDATION_FAILED` | `@MinLength` / `@MaxLength` du DTO |

`CLIENT_NOT_FOUND` est **le code du module clients**, pas un code neuf : deux
modules qui nomment differemment le meme fait obligent le frontend a traiter deux
cas pour une seule situation. Aucun code d'erreur n'a ete invente pour ce
chantier.

---

## 8. Ce que le test de bout en bout prouve

`test/identity.e2e-spec.ts`, trois scenarios ajoutes :

1. **La preuve, en deux moities.** Le compte est cree **par l'API** avec son
   `clientId`, se connecte avec le mot de passe genere, change son mot de passe
   force, puis :
   - `GET /clients/<dossier A>` → `200` et l'identifiant attendu ;
   - `GET /clients/<dossier B>` → **`404 CLIENT_NOT_FOUND`** ;
   - `GET /users/<compte de l'administrateur>` → **`404 USER_NOT_FOUND`** ;
   - `GET /users` → `403` ; `GET /users/<son propre compte>` → `200`.
   La premiere moitie seule ne prouverait rien — un compte qui verrait tout
   passerait les memes assertions.

2. **Les refus.** Dossier inexistant (`404`, et **aucune** ligne laissee en base,
   verifie en Prisma) ; rattachement a un compte non-`CLIENT` (`422`) ; porteur
   sans droit de lecture du dossier (`403`), y compris apres que la route lui a
   ete ouverte par un droit accorde puis retire.

3. **Les trois etats et la coherence des roles.** Un renommage ne touche pas le
   rattachement et la ligne `USER_UPDATED` porte bien `clientId` ; retirer le role
   `CLIENT` est refuse en `422` **et le compte est intact** ; `clientId: null`
   detache et ecrit une seconde ligne `USER_CLIENT_SCOPE_CHANGED` ; le changement
   de role refuse precedemment passe alors.

Resultat mesure : `29 tests, 29 pass, 0 fail`. La base est laissee propre : zero
compte `e2e-ident-*` residuel, zero dossier residuel, et le role `DEVELOPER`
retrouve exactement ses 20 permissions — le droit accorde temporairement est
retire dans un `finally`, quoi qu'il arrive.
