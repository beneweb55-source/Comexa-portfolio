# Tests Comexa — comment les lancer, et pourquoi ils sont ecrits ainsi

Ce document existe parce que la suite de bout en bout de ce projet tourne contre
une **vraie base PostgreSQL** (Neon), partagee, et **cumulative**. Ce n'est pas
un detail d'implementation : c'est ce qui explique la moitie des regles ci-dessous.
Trois defauts reels ont ete trouves parce qu'une assertion supposait une base
vide, ou un etat stable, dans un environnement qui n'est ni l'un ni l'autre.

---

## 1. Les deux suites

| Commande | Ce qu'elle execute | Base de donnees |
|---|---|---|
| `npm test` | `node --import tsx --test "src/**/*.spec.ts"` | **Aucune.** Specs unitaires, fonctions pures. |
| `npm run test:e2e` | `npm run build:e2e` puis `node --test --test-concurrency=1 ".e2e-build/test/**/*.e2e-spec.js"` | La base Neon de `.env`. |

`npm run build:e2e` vaut `tsc -p tsconfig.e2e.json` : il compile `src/` **et**
`test/` dans `.e2e-build/`, dossier distinct de `dist/` (l'artefact de
production, que `nest build` vide a chaque build).

### Pourquoi la suite unitaire tourne sous `tsx`, et pas l'e2e

`tsx` s'appuie sur esbuild, qui **n'emet pas** la metadonnee
`design:paramtypes` malgre `emitDecoratorMetadata: true`. Une application Nest
demarree sous `tsx` ne peut donc pas resoudre ses injections et echoue au
demarrage. Les specs unitaires n'ont pas de conteneur d'injection : elles
passent. C'est aussi pourquoi la production demarre par `node dist/main.js`.

### Pourquoi `--test-concurrency=1`

Par defaut, `node --test` execute les **fichiers de test en parallele**. Dix
fichiers frappant **une seule base** se marchent dessus : une suite compte les
lignes qu'une autre est en train d'ecrire.

Mesure, meme commit, meme base :

| Execution | Resultat | Duree |
|---|---|---|
| Parallele (defaut) | **6 echecs + 16 annulations** | ~102 s |
| Serial (`--test-concurrency=1`) | **8 echecs + 0 annulation** | ~621 s |

Le point contre-intuitif : **le parallele produisait AUSSI de faux echecs**. La
suite « Rapports, tableaux de bord et parametres » passait au vert en serial et
echouait en parallele, sans qu'une ligne de son code ait change. Le nombre
d'echecs plus eleve en serial est trompeur : en parallele, les 16 tests de
facturation etaient **annules** par un seul `before` en echec, donc jamais
executes.

Le cout est de ~10 minutes. Une suite qui ment coute plus cher.

**CE TABLEAU EST UNE MESURE HISTORIQUE, PAS UN RESULTAT ATTENDU.** Il a servi a
trancher entre les deux modes, et il a rempli son role. Ses chiffres datent d'un
commit anterieur (173 tests) et ne decrivent plus la suite. **Les lire comme un
seuil normal rendrait cette suite inutile** : des tests rouges qu'on tient pour
normaux n'apprennent plus rien — ce qui est exactement ce que
`--test-concurrency=1` existe pour eviter.

Les huit echecs de la colonne seriale se repartissaient sur cinq suites et
portaient tous sur une assertion, jamais sur une panne : un compte client
attendu en `200` et rendu en `400`, un temoignage publie compte `3` fois au lieu
d'`1`, une boite de reception rendue avec `3` non-lues au lieu de `0`. Ce sont
les deux signatures que ce document decrit plus bas — une base **cumulative**
(`3` au lieu de `1`, c'est le residu d'une autre suite) et des assertions plus
anciennes que le code qu'elles verifient. Ils ont ete corriges un par un.

Etat confirme, arbre actuel, meme commande et meme base :

| Mesure | Resultat |
|---|---|
| Fichiers de `test/` | 10 |
| Tests | 188 |
| Echecs | **0** |
| Annulations | 0 |
| Duree | ~931 s |

Le decompte porte sur les FICHIERS et non sur ce que `node --test` appelle des
« suites » : son rapport en compte onze, parce qu'il compte les `describe` et que
`docs.e2e-spec.ts` en porte deux. Un chiffre qui depend du decoupage interne d'un
fichier ne dit rien d'utile ; le nombre de fichiers, si.

La duree, elle, a ete mesuree pendant que des compilations tournaient en
parallele sur la meme machine : c'est un majorant, pas une reference.

Une execution verte est donc la seule lecture valable de ce tableau-ci. Si vous
relancez la suite et lisez autre chose que zero echec, ce n'est pas la norme :
c'est une regression.

---

## 2. La base est partagee ET cumulative : la regle qui en decoule

`prisma/seed.ts` peuple la base, **y compris le contenu public** (services,
packs, temoignages, realisations, questions, partenaires) **et un dossier metier
complet** (devis accepte, projet, equipe, taches, jalons, facture partiellement
payee, paiement). Une suite qui demarre ne trouve donc **jamais** une base vide,
et une execution precedente laisse ses traces si elle a mal nettoye.

**CE DOSSIER METIER A UNE CONSEQUENCE DIRECTE ICI.** Il porte des montants en
`EUR` : un projet a `7668.00`, une facture encaissee de `3067.20`. Toute
assertion sur un **total d'agence** est donc fausse par construction, quel que
soit le soin pris a nettoyer — la ligne du seed, elle, reste. C'est pourquoi
`analytics.e2e-spec.ts` isole ses montants sous une devise de test `XTS` plutot
que sous `EUR`, et n'affirme la forme (`/^\d+\.\d{2}$/`) sur les valeurs
d'agence. Suivez ce modele : **une devise a vous, ou une assertion de forme**.
Le point 3 ci-dessous (« ne jamais toucher aux donnees du seed ») vaut desormais
aussi pour ces lignes-la.

**INTERDIT : une assertion sur un etat global.**

```ts
// FAUX — « la boite de ce commercial est vide » : une AUTRE suite y a
// legitimement depose une notification de demande de contact, puisque
// `notifyAgency` notifie tous les porteurs ADMIN et SALES actifs.
const notification = await prisma.notification.findFirst({ where: { userId } });
assert.equal(notification, null);
```

```ts
// JUSTE — on interroge l'entite que CE test vient de creer.
const notification = await prisma.notification.findFirst({
  where: { userId, entityId: client.id },
});
```

De meme, `assert.equal(items.length, 1)` sur une liste **globale** est faux par
construction ; il faut filtrer sur les identifiants crees par le test.

Trois defauts de cette famille ont ete corriges, tous de la meme forme :

| Spec | Ce qu'elle supposait | Ce que la base contenait |
|---|---|---|
| `content.e2e-spec.ts` | « un seul temoignage publie » | 3, dont ceux du seed |
| `crm.e2e-spec.ts` | « la boite du commercial est vide » | une notification d'une autre suite |
| `messaging.e2e-spec.ts` | « la boite de l'auteur est vide » | idem — l'auteur porte le role ADMIN |

Une assertion reste **au moins aussi forte** apres ce changement : elle porte
sur l'entite de l'action, donc elle prouve toujours la propriete visee (« on ne
notifie pas l'auteur de sa propre action »), sans dependre d'un voisin.

---

## 3. Ce que chaque spec doit faire

1. **Creer ses propres fixtures**, sous un prefixe identifiable
   (`e2e-billing-...`, `e2e-fullchain-visitor-...`).
2. **Les supprimer dans `after()`**, dans l'ordre inverse de la creation.
   Une spec qui laisse ses lignes fabrique l'echec de la suivante.
3. **Ne jamais toucher** aux donnees du seed ni a celles d'une autre spec.
4. **Ne pas balayer « par prefixe + anciennete »** pour se nettoyer : une autre
   instance du **meme** fichier peut tourner en meme temps, et une reprise trop
   large **supprime les comptes d'une execution vivante**. C'est arrive : une
   spec nettoyait les comptes anterieurs a son propre demarrage, ce qui
   incluaient ceux d'une instance commencee trente secondes plus tot. D'ou un
   seuil d'age de trente minutes (`STALE_AFTER_MS`) dans
   `full-chain.e2e-spec.ts` : la suite dure deux minutes, un compte plus vieux
   est forcement un debris.
5. **Prouver par une relecture**, pas par la reponse de l'ecriture : « creer par
   une route, relire par une autre ». Un `POST` qui rend 201 ne prouve pas que
   la ligne est relisible.

---

## 4. Pieges de l'assemblage

- **`test:e2e` enchaine par `&&`** : une seule erreur `tsc` annule toute la
  suite, sans qu'un seul test ait tourne.
- **`tsconfig.e2e.json` etend `tsconfig.json`** et n'en surcharge que `outDir`
  et `incremental`. Il **herite donc de `noUnusedLocals`** : une variable
  inutilisee dans une spec bloque l'e2e entiere.
- **`.e2e-build` est partage** : ne lancez pas deux `build:e2e` en concurrence.
  Pour executer un seul fichier :
  `npx tsc -p tsconfig.e2e.json && node --test ".e2e-build/test/<fichier>.e2e-spec.js"`.
- **Les tests demarrent l'application par `configureApp()`**, la meme fonction
  que `main.ts`. Ce qui est teste est donc ce qui est deploye — pipe de
  validation (`forbidNonWhitelisted`), filtre d'exceptions et enveloppe de
  reponse compris. Un test qui demarrerait `AppModule` seul validerait une
  application qui n'existe pas.

---

## 5. Les specs, et ce que chacune couvre

| Fichier | Perimetre |
|---|---|
| `auth.e2e-spec.ts` | Parcours d'authentification, sessions, mot de passe |
| `identity.e2e-spec.ts` | Utilisateurs, roles, permissions, journal d'audit |
| `content.e2e-spec.ts` | Site public : formulaire de contact, contenus, moderation |
| `crm.e2e-spec.ts` | Prospects, pipeline commercial, conversion en client |
| `projects.e2e-spec.ts` | Projets, taches, jalons, saisie de temps |
| `billing.e2e-spec.ts` | Devis, factures, paiements, perimetre client |
| `messaging.e2e-spec.ts` | Conversations, messages, notifications |
| `analytics.e2e-spec.ts` | Rapports, tableaux de bord, parametres |
| `docs.e2e-spec.ts` | Le document OpenAPI : exigence de securite, resumes, egalite avec `shared/api/openapi.json` |
| `full-chain.e2e-spec.ts` | La chaine complete, visiteur -> projet termine |

Le dernier est l'audit exige par le client : il deroule les quinze etapes de la
chaine metier par l'API HTTP reelle, et confronte chaque reference relue a
`^(PRO|CLI|PRJ|DEV|FAC|PAY)-\d{4}-\d{4}$` — la seule preuve que la table
`Counter` est reellement traversee.

## 6. Les deux verifications hors suite

Ces deux scripts ne sont pas des tests : ils ne tournent pas dans la suite, ne
sont pas hermetiques, et **parlent a des services reels**. Ils repondent a des
questions qu'aucune suite locale ne peut trancher.

| Commande | Ce qu'elle etablit | Cible |
|---|---|---|
| `npm run verify:storage` | Le stockage objet est utilisable tel quel : ecriture, relecture, **lien signe reellement suivi**, absence reconnue, suppression confirmee | Backblaze B2, depuis la machine |
| `npm run smoke:prod` | La chaine metier complete tient sur le service **deploye**, de VISITEUR a PROJET TERMINE | Le service Render, par HTTP |

### Pourquoi ils ne sont pas dans `test` ni `test:e2e`

Ce n'est pas un oubli. `test:e2e` monte l'application EN MEMOIRE : il ne peut donc
rien dire de ce qui n'existe qu'une fois deploye — que le conteneur demarre avec
les variables qu'il a vraiment, que Neon soit joignable **depuis Render**, que les
migrations soient appliquees sur la base que le service interroge, que le stockage
reponde depuis ce reseau-la. Ce sont exactement les points sur lesquels un
deploiement echoue alors que la suite locale est verte.

### `smoke:prod` ECRIT DANS LA BASE DE PRODUCTION

Un dossier client, un projet, des taches, un devis, une facture, un paiement,
quatre documents. Tout est supprime a la fin, **y compris quand une etape
echoue**, et le nettoyage se verifie lui-meme — il compte ce qui reste et doit
trouver zero. Deux mesures rendent cela praticable :

- le balayage des restes au demarrage reprend ce qu'une execution interrompue a
  laisse, **avec un delai de garde de 30 minutes** : sans ce seuil, deux
  executions simultanees se supprimeraient mutuellement leurs comptes — c'est un
  bug reel, documente dans `full-chain.e2e-spec.ts` ;
- rien n'est envoye a une adresse joignable : tous les comptes portent un domaine
  `@comexa.example`, reserve par la RFC 2606.

Lancer l'un ou l'autre **sans argument** vise la cible par defaut. Pour
`smoke:prod`, on peut en changer :

```bash
npm run smoke:prod -- https://autre-service.onrender.com
SMOKE_BASE_URL=https://autre-service.onrender.com npm run smoke:prod
```

Les deux lisent leurs identifiants dans `backend/.env` — jamais dans
`.env.render`, qui est le fichier des variables d'hebergeur.
