# Conversion d'une demande de contact en prospect

> **Fichier dedie, a fusionner dans `docs/API.md`.**
> Il n'a pas ete ecrit directement dans `docs/API.md` parce que ce fichier est
> modifie en parallele par un autre chantier (rattachement `clientId` des
> comptes) : deux ecritures concurrentes sur un fichier de 20 Ko se perdent
> silencieusement. Les sections ci-dessous sont redigees pour etre collees telles
> quelles dans `docs/API.md` (§5 « Contact » ou §4 « Autorisation » selon
> l'emplacement retenu).

---

## 1. Le trou que cette route ferme

La chaine metier exigee par le client est :

    VISITEUR -> prise de contact -> PROSPECT -> suivi commercial -> DEVIS -> acceptation -> CLIENT

Le premier anneau etait ouvert. `contactrequest:convert:any` existait au
catalogue depuis le debut, `ContactRequestService.update` refusait explicitement
le statut `CONVERTED` en renvoyant vers « le module commercial », et le modele
`ContactRequest` portait deja la colonne de rattachement — mais **aucune route ne
convertissait une demande en prospect**. Le prospect devait etre cree a la main
hors API, et la demande restait indefiniment dans la file.

`POST /api/contact-requests/:id/convert` ferme cet anneau.

**La mention « route annoncee, non ecrite » est retiree.** Elle ne se trouvait
pas dans `docs/API.md` (le fichier ne mentionnait ni `contactrequest` ni
`ContactRequest`) : elle vivait dans les commentaires de
`src/modules/content/contact-request.controller.ts` et de
`src/modules/content/contact-request.service.ts`, qui renvoyaient vers le module
commercial. Ces commentaires sont desormais exacts : le module commercial porte
la route.

---

## 2. La route

| | |
|---|---|
| **Verbe et chemin** | `POST /api/contact-requests/:id/convert` |
| **Permission** | `contactrequest:convert:any` — « Convertir une demande de contact en prospect » |
| **Codes qui la detiennent** | `ADMIN` (`'ALL'`), `SALES`, `COMMUNICATION_MANAGER` |
| **Corps** | **aucun** |
| **Reponse de succes** | `200 OK` (`@HttpCode(HttpStatus.OK)`) |
| **Controleur** | `src/modules/prospects/contact-request-conversion.controller.ts` |
| **Service** | `ProspectsService.convertContactRequest` |

### Pourquoi ce chemin est porte par le module commercial

Le chemin appartient a la ressource DEMANDE, mais le geste CREE un prospect :
regle, numerotation `PRO-`, journal d'etapes, audit et notification vivent dans
le module commercial. C'est le **precedent exact de `QuoteInvoiceController`**
(`app.module.ts`, section FACTURATION) : un controleur du module FACTURES qui
porte le chemin `quotes`, parce que c'est le module factures qui detient la regle
et la numerotation. Deux controleurs partagent donc le prefixe
`contact-requests`, et c'est voulu :

- `ContentModule` garde la file de traitement (`GET`, `GET :id`, `PATCH :id`,
  `DELETE :id`), les notes internes et le refus de `CONVERTED` ;
- `ProspectsModule` y ajoute le seul geste qui fait naitre une piste.

### Pourquoi le corps est vide

Rien de ce que l'appelant pourrait ecrire n'a sa place ici : l'etat de la
demande, sa reference, le responsable de la piste et la date de conversion sont
decides par le serveur. Accepter un `status`, un `ownerId` ou une `reference` en
corps reviendrait a laisser l'appelant fabriquer une piste sans origine
verifiable — or toute la valeur de cette conversion est que l'origine soit
certaine. Le `ValidationPipe` global (`forbidNonWhitelisted`) refuse d'ailleurs
ces champs en `400 VALIDATION_FAILED` avant meme d'atteindre le service.

### Idempotence : un refus, pas un upsert

Une demande donne **au plus un prospect**. Une seconde conversion n'est pas un
succes silencieux : c'est un `409`. La garantie n'est pas un `if` de pre-lecture
(qui perd la course entre deux appels simultanes) mais un **compare-and-swap** :
la condition `convertedProspectId: null` accompagne l'ecriture elle-meme
(`updateMany`). Le perdant annule sa transaction entiere — la fiche qu'il venait
de creer et le numero `PRO-` qu'il venait de consommer disparaissent avec elle.
L'unicite est de surcroit posee en base (index unique, voir §6).

---

## 3. Reponse de succes — `200`

L'enveloppe est celle de `TransformInterceptor` : `{ success: true, data }`.

```json
{
  "success": true,
  "data": {
    "prospect": {
      "id": "clz9x2v7b0000qk5t3j1h8w4m",
      "reference": "PRO-2026-0007",
      "companyName": "Atelier Ferrand",
      "contactFirstName": "Camille",
      "contactLastName": "Ferrand",
      "email": "camille.ferrand@atelier-ferrand.example",
      "phone": "+33 5 56 00 00 07",
      "jobTitle": "Directrice",
      "website": "https://atelier-ferrand.example",
      "source": "CONTACT_FORM",
      "budgetRange": "FROM_15K_TO_30K",
      "status": "NEW",
      "ownerId": "clz9x1a2b0000qk5t9p0d3k1v",
      "convertedClientId": null,
      "convertedAt": null,
      "deletedAt": null
    },
    "contactRequest": {
      "id": "clz9w8m4c0001qk5t7f2n6r9d",
      "reference": "CTR-2026-0042",
      "status": "CONVERTED",
      "handledById": "clz9x1a2b0000qk5t9p0d3k1v",
      "handledAt": "2026-09-29T09:14:02.431Z",
      "convertedProspectId": "clz9x2v7b0000qk5t3j1h8w4m",
      "convertedAt": "2026-09-29T09:14:02.431Z",
      "deletedAt": null
    }
  }
}
```

Ce que la reponse garantit, et qui se verifie par le lien :

| Champ | Regle |
|---|---|
| `prospect.reference` | `PRO-<annee>-<sequence>`, distribue par le compteur **partage** (`CounterService`, scope `PROSPECT`), jamais par un compteur local. |
| `prospect.source` | `CONTACT_FORM` — l'origine est ecrite, pas deduite. |
| `prospect.status` | `NEW` : le schema le pose, et une ligne de journal le constate. |
| `prospect.ownerId` | Le **traitant de la demande** s'il y en avait un, sinon **l'auteur de la conversion** (il vient de la convertir, la fiche ne peut pas rester sans responsable). |
| `prospect.notes` | Reprend la reference de la demande, son sujet et le message du visiteur : le commercial lit la demande d'origine dans la fiche. |
| `prospect.budgetRange` | Reprise telle quelle de la demande. |
| `contactRequest.status` | `CONVERTED` — le seul chemin qui pose cet etat. |
| `contactRequest.convertedProspectId` | Lien vers la fiche creee. |
| `contactRequest.convertedAt` | Horodatage serveur. |
| `contactRequest.handledById` | Pose **au premier** traitement et **jamais ecrase** : convertir une demande que personne n'avait ouverte la marque prise en charge par l'auteur de la conversion. |

Le lien se lit dans les deux sens :

- **demande -> prospect** : `GET /api/contact-requests/:id` rend
  `convertedProspectId` ;
- **prospect -> demandes** : `Prospect.contactReqs` (relation inverse). Elle n'a
  pas de route dediee, et c'est normal — un prospect peut naitre de plusieurs
  demandes, alors que l'index unique garantit qu'une demande ne produit qu'un
  prospect.

---

## 4. Reponses d'echec

Enveloppe de `AllExceptionsFilter` : `{ success: false, error: { code, message, details } }`.
**Aucune trace de pile ne sort de l'API.**

| HTTP | Code | Quand |
|---|---|---|
| `401` | `UNAUTHENTICATED` | Sans jeton, ou jeton illisible. |
| `403` | `FORBIDDEN` | Authentifie mais sans `contactrequest:convert:any` — dont le role `CLIENT`, qui ne detient aucun code `contactrequest:*`. |
| `404` | `CONTACT_REQUEST_NOT_FOUND` | Demande inconnue, **ou retiree de la file** (suppression logique : `deletedAt` non nul). Une demande que l'agence a explicitement ecartee ne produit pas de piste. |
| `409` | `CONTACT_REQUEST_ALREADY_CONVERTED` | La demande porte deja un `convertedProspectId`. **Aucune fiche n'est creee.** |
| `429` | `RATE_LIMITED` | Quota global. |

**Il n'y a pas de `400` sur cette route — et ce tableau en annoncait un.** La
ligne « corps non vide » a ete retiree : elle decrivait un refus que le code ne
produit pas. Le handler ne declare aucun `@Body()`, donc le corps n'est transmis
a aucun pipe, et `forbidNonWhitelisted` n'a rien a rejeter. Un corps non vide est
**ignore**, pas refuse.

C'est une protection plus forte que celle qui etait decrite, et pas une
protection perdue : un champ comme `status`, `ownerId` ou `reference` ne peut pas
influencer la conversion parce qu'il n'est jamais lu — la fiche est construite a
partir de la demande stockee, pas de la requete. Seul un corps JSON **malforme**
produit un `400`, leve par l'analyseur du corps de la requete, et non par
`VALIDATION_FAILED`.

`CONTACT_REQUEST_ALREADY_CONVERTED` est un code **nouveau**, a ajouter a la
liste des codes metier de `docs/API.md` (§3), a cote de
`QUOTE_ALREADY_ACCEPTED` dont il suit la convention. Il est distinct du
`CONTACT_REQUEST_CONVERT` (`422`) deja leve par
`ContactRequestService.update` : celui-ci dit « ne posez pas ce statut a la
main », celui-la dit « c'est deja fait ».

### 404 et non 403, 409 et non 422

- `404` sur une demande inexistante : l'appelant ne peut pas apprendre par un
  `403` qu'une demande existe alors qu'il n'y a pas droit.
- `409` sur une seconde conversion : la requete est parfaitement bien formee, et
  l'etat metier la refuse. C'est la meme reponse que `POST /prospects/:id/convert`
  sur une fiche deja convertie, et que `POST /quotes/:id/invoice` sur un devis
  deja facture.

---

## 5. Ce que la transaction contient

Une seule transaction, ou rien :

1. lecture de la demande (`deletedAt: null`) ;
2. refus si `convertedProspectId` est deja pose ;
3. reservation du numero `PRO-` aupres du compteur partage, **dans** la
   transaction ;
4. creation du `Prospect` (`source: CONTACT_FORM`, coordonnees reprises) ;
5. compare-and-swap sur la demande : `convertedProspectId`, `convertedAt`,
   `status: CONVERTED`, et `handledById`/`handledAt` seulement s'ils etaient
   vides ;
6. premiere ligne du journal d'etapes (`fromStatus: null` = creation,
   `toStatus: NEW`) ;
7. temoin d'activite (`MILESTONE_REACHED`, `isClientVisible: false`) — il n'y a
   pas encore de client, et le pipeline commercial est interne ;
8. notification du responsable de la fiche, **sauf** si le responsable est
   l'auteur de la conversion.

Puis, **apres le commit**, une entree d'audit :
`action: 'CONTACT_REQUEST_CONVERTED'`, `entityType: 'ContactRequest'`,
`entityId` = la demande, `before: { status, convertedProspectId }`,
`after: { status, convertedProspectId, prospectReference, ownerId }`. L'audit est
en « best effort » et ne rejoint pas la transaction, comme partout ailleurs.

L'activite et la notification passent par `ActivityService.record` et
`NotificationService.notify` avec le `tx` : jamais par un `prisma.activity.create`
local, sinon `isClientVisible` varierait selon l'auteur du code.

---

## 6. Migration : **aucune n'a ete necessaire**

Le lien existe deja dans le schema, et donc dans la migration initiale. Aucune
migration n'a ete ecrite, aucun `migrate dev` n'a ete lance, **aucune donnee n'a
ete touchee**.

`prisma/schema.prisma`, modele `ContactRequest` :

```prisma
/// Prospect issu de cette demande. Unique : une demande donne au plus un
/// prospect, sinon le pipeline double ses chiffres.
convertedProspectId String?   @unique
convertedProspect   Prospect? @relation(fields: [convertedProspectId], references: [id], onDelete: SetNull)
convertedAt         DateTime?
```

et modele `Prospect`, la relation inverse : `contactReqs ContactRequest[]`.

`prisma/migrations/20260928234223_init/migration.sql` :

| Ligne | Objet |
|---|---|
| 630 | `"convertedProspectId" TEXT,` (colonne, table `contact_requests`) |
| 631 | `"convertedAt" TIMESTAMP(3),` |
| 1178 | `CREATE UNIQUE INDEX "contact_requests_convertedProspectId_key" ON "contact_requests"("convertedProspectId");` |
| 1490 | `ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_convertedProspectId_fkey" FOREIGN KEY ("convertedProspectId") REFERENCES "prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;` |

### Sens du lien : pourquoi `ContactRequest.convertedProspectId`

C'est le schema qui l'impose, et il a raison : la **demande est le document
d'origine**, le prospect est l'entite creee. Porter la cle sur l'origine donne
`@unique` gratuitement — donc « au plus un prospect par demande », la contrainte
que le pipeline exige — alors qu'un `contactRequestId` sur le prospect aurait
autorise plusieurs fiches pour une meme demande, et fait doublonner les chiffres
de l'entonnoir. `onDelete: SetNull` est le bon comportement : la fiche survit a
la demande, le lien se detache.

Verification executee (base reelle, aucune ecriture) :

```console
$ npx prisma migrate status
Database schema is up to date!

$ npx prisma db execute --file ./tmp-probe.sql
Script executed successfully.
```

ou `tmp-probe.sql` contenait une lecture de la colonne :

```sql
SELECT id, "convertedProspectId", "convertedAt", status FROM contact_requests LIMIT 1;
```

En Prisma 7, l'URL de la source de donnees vient de `prisma.config.ts` :
`--schema` n'est pas accepte par `db execute`.

---

## 7. Utilisation depuis le frontend

```ts
// La demande que l'agence vient d'ouvrir dans sa file.
const reponse = await fetch(`/api/contact-requests/${demandeId}/convert`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${jeton}` },
});

if (reponse.status === 409) {
  // Deja convertie : rafraichir la file, la fiche existe.
}

const { data } = await reponse.json();
naviguer(`/prospects/${data.prospect.id}`); // data.prospect.reference = PRO-...
```

Points d'attention pour l'integration :

- **pas de corps** : envoyer `{}` est inutile, et envoyer
  `{ status: 'CONVERTED' }` n'a aucun effet — ce n'est pas refuse en `400`,
  c'est ignore : la route ne lit jamais le corps. Le tableau des refus du §4
  detaille pourquoi, et la ligne `400` qui s'y trouvait a ete retiree ;
- le `409` n'est pas une erreur technique : c'est un etat metier a afficher (la
  demande a deja son prospect, il faut recharger la file) ;
- la reponse porte **la fiche** : inutile d'enchainer un `GET /prospects/:id`
  pour l'afficher. C'est le meme contrat que `POST /prospects/:id/convert`.

---

## 8. Scenarios verifies

Sur la vraie base, par HTTP, a travers la chaine
complete de gardes, pipe, filtre et intercepteur. Quatre scenarios :

1. **conversion nominale** : une demande arrive par le **formulaire public**
   (`POST /api/public/contact-requests`, le seul envoi de ce fichier qui emprunte
   la route quotaee), est convertie, et l'on verifie la reference `PRO-`, la
   source `CONTACT_FORM`, les coordonnees copiees, la reference de la demande
   dans les notes, la demande passee a `CONVERTED` avec sa date, le lien dans les
   deux sens, la ligne unique du journal, l'entree d'audit, le temoin d'activite
   interne, puis une **seconde tentative en `409`** suivie du comptage qui
   compte vraiment : un seul prospect pour cette demande ;
2. **authorization** : `CLIENT` -> `403 FORBIDDEN`, anonyme -> `401` ;
3. **`404`** sur une demande inconnue, et sur une demande **retiree de la file**
   (suppression logique), en verifiant que le refus n'a rien ecrit ;
4. **attribution et notification** : une demande prise en charge par
   l'administrateur, convertie par le commercial — la piste revient au traitant,
   il est notifie, et l'auteur de la conversion ne se notifie pas lui-meme.

Les fixtures autres que le formulaire public sont ecrites directement en base
avec une reference tiree du compteur partage : faire tourner le formulaire pour
chaque fixture epuiserait son quota (5 envois par minute) et declencherait la
notification de l'agence a chaque fois, pour des demandes qui ne sont pas le
sujet du scenario. Le nettoyage se fait dans l'ordre des cles etrangeres.

---

## 9. Fichiers

| Fichier | Etat |
|---|---|
| `src/modules/prospects/prospects.service.ts` | modifie — `convertContactRequest`, interface `ProspectFromContactRequest`, trois helpers |
| `src/modules/prospects/contact-request-conversion.controller.ts` | **cree** |
| `src/modules/prospects/prospects.module.ts` | modifie — deuxieme controleur declare |
| `prisma/schema.prisma` | **non modifie** |
| `prisma/migrations/` | **aucune migration ajoutee** |
| `docs/API.md` | **non modifie** (ce fichier-ci est a fusionner) |
