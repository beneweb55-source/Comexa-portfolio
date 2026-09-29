# Comexa — backend

API REST + passerelle temps reel du projet Comexa. NestJS 12 (ESM), Prisma 7,
PostgreSQL. Le frontend Next.js vit a la racine du depot et consomme cette API :
il n'est pas dans ce dossier, et rien ici ne depend de lui.

---

## 1. Demarrage

```bash
cd backend
cp .env.example .env        # puis renseigner les valeurs (voir §2)
npm install
npm run prisma:generate     # OBLIGATOIRE — voir ci-dessous
npm run prisma:deploy       # applique les migrations
npm run db:seed             # contenu public + roles + permissions
npm run start:dev           # http://localhost:3001/api
```

**Pourquoi `prisma:generate` est une etape a part.** Le client Prisma est
genere dans `src/generated/`, qui **n'est pas versionne** : c'est un artefact
derive du schema, et le committer ferait diverger le depot de `schema.prisma`
des la premiere migration. Un clone neuf ne compile donc pas tant qu'il n'a pas
lance cette commande. C'est la premiere cause d'un `tsc` en echec ici.

**Le seed est idempotent** : il peut etre relance sans creer de doublons. Il
installe les roles, les codes de permission, et le contenu public du site
(services, packs, temoignages, realisations, questions, partenaires).

> **`npm run db:reset` est destructeur.** Il vaut `prisma migrate reset --force`
> et **efface toutes les donnees**. Cette API partage une base Neon, y compris
> avec la suite de tests e2e : ne le lancez pas sur une base qui compte.

---

## 2. Variables d'environnement

Le modele complet et commente est `.env.example`. Les points qui se paient cher
quand on les rate :

| Variable | Pourquoi elle compte |
|---|---|
| `DATABASE_URL` | Connexion **poolisee** (`-pooler` chez Neon), utilisee au runtime. |
| `DIRECT_URL` | Connexion **directe**, utilisee par les **migrations**. Le DDL passe mal par un pooler en mode transaction : les deux URL sont necessaires, et ce ne sont pas les memes. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | **Deux secrets differents.** Un access token ne doit pas pouvoir servir de refresh token. |
| `SMTP_HOST` | **Obligatoire en production** : le serveur refuse de demarrer sans. Le parcours « mot de passe oublie » repond toujours 200 pour ne pas reveler quels comptes existent ; cette reponse n'est honnete que si le courriel part reellement. En developpement, laissez vide : le lien est ecrit dans les journaux. |
| `STORAGE_DRIVER` | `local` en developpement, `s3` en production. Les binaires ne vont **jamais** dans PostgreSQL : la base ne conserve que les metadonnees et la cle de stockage. |
| `CORS_ORIGIN` | Origines autorisees, separees par des virgules. En dev, le frontend Next tourne sur `3000`. |
| `TRUST_PROXY` | Confiance aux en-tetes `X-Forwarded-*`. **Derriere un reverse proxy, mettre `1`** : sans cela le limiteur de debit global compte toutes les requetes sous l'adresse du proxy et finit par repondre 429 a tout le monde. `true` est deconseille. Voir `src/common/http/client-ip.ts`. |

`.env` est ignore par git ; `.env.example` ne doit **jamais** contenir de secret.

---

## 3. Points d'entree

| | |
|---|---|
| API | `http://localhost:3001/api` |
| Swagger | `http://localhost:3001/api/docs` — **monte uniquement hors production** |
| Sante | `GET /api/health` — `src/health/health.controller.ts` |
| Temps reel | meme port, `socket.io`, poignee de main authentifiee |

**Enveloppe des reponses.** Un seul format pour le frontend : succes
`{ success: true, data, meta? }`, erreur
`{ success: false, error: { code, message, details } }`. Les listes paginees
sont aplaties : `data` **est** le tableau, et `meta` est a cote — il porte
`page`, `perPage`, `total` et `totalPages` (le nom est `perPage`, pas
`pageSize`). `totalPages` vaut `0` sur une liste vide, pas `1` : sinon le
frontend affiche « page 1 sur 1 » sur une liste qui n'existe pas. Defauts de
pagination : `page=1`, `perPage=20`, maximum `100`.

**Codes d'erreur stables.** `error.code` est un contrat (`PROJECT_NOT_FOUND`,
`VALIDATION_FAILED`, `FORBIDDEN`, ...) ; `error.message` est destine a l'humain
et peut changer. Le frontend commute sur `code`, jamais sur `message`. Aucune
trace de pile ne sort en production. Les details d'une erreur de validation
nomment la propriete fautive (`clientId should not exist`), jamais sa valeur.

**Perimetre client.** Un porteur CLIENT ne lit que son propre dossier. Toute
ressource hors perimetre rend **404, jamais 403** : cela ne revele pas
l'existence d'une ligne. Un `clientId` envoye a la main dans une requete ne
peut pas elargir ce perimetre.

---

## 4. Tests

```bash
npm test          # specs unitaires — AUCUNE base de donnees, ~secondes
npm run test:e2e  # bout en bout — VRAIE base Neon, ~10 minutes, serial
```

La suite e2e frappe une base **partagee et cumulative**. Deux regles en
decoulent, et elles sont non negociables : aucune assertion sur un etat global,
et chaque spec nettoie ses propres fixtures. `docs/TESTING.md` explique le
pourquoi, les pieges d'assemblage et l'inventaire des suites.

Les tests demarrent l'application par `configureApp()` — la meme fonction que
`main.ts`. Ce qui est teste est donc ce qui est deploye.

---

## 5. Documentation

| Fichier | Contenu |
|---|---|
| `docs/API.md` | Le contrat HTTP : routes, permissions, enveloppe, codes d'erreur, ecarts connus. |
| `docs/TESTING.md` | Les deux suites, la base partagee, les regles que chaque spec doit suivre. |
| `docs/security-audit.md` | Revue de securite : RBAC, IDOR, mot de passe, en-tetes. |
| `/api/docs` | OpenAPI genere depuis le code (hors production). |

---

## 6. Docker

```bash
docker compose up --build
```

`Dockerfile` construit l'artefact de production ; l'image **ne contient pas de
`.env`** : les variables viennent de l'environnement d'execution. Le demarrage
en production se fait par `node dist/main.js` — jamais par `tsx`, qui n'emet pas
la metadonnee de decorateurs dont depend l'injection de dependances de Nest.

---

## 7. Limite connue : `npm run lint` n'est pas executable ici

**Le fait.** `npm run lint` echoue avec
`ERR_MODULE_NOT_FOUND: Cannot find package 'eslint' imported from .../eslint.config.mjs`.
Ce n'est pas une regression : ce script n'a jamais pu tourner dans cette
arborescence, pour une raison de disposition des fichiers.

**La cause.** Le script vaut `eslint "{src,test,prisma}/**/*.ts" --fix` et ne
passe **pas** de `--config`. Quand un `--config` est absent, ESLint remonte
l'arborescence depuis chaque fichier analyse et s'arrete au premier
`eslint.config.*` rencontre. Ce dossier n'en contient aucun : il remonte donc
jusqu'a `../eslint.config.mjs`, la configuration **Next.js du frontend**, dont
les imports (`eslint/config`, `eslint-config-next`, `eslint-config-next/core-web-vitals`)
ne se resolvent pas — la racine du depot n'a pas de `node_modules` dans un clone
du backend seul. D'ou l'echec.

**Pourquoi cela n'a pas ete corrige ici.** Une configuration a bien ete ecrite
puis retiree : elle est bloquee par le garde-fou `config-protection` de
l'outillage local, qui interdit toute modification d'un fichier
`eslint.config.*`. Ce garde-fou protege une intention juste — empecher qu'on
affaiblisse les regles pour faire taire des avertissements — et il ne revient
pas a cette livraison de le desactiver. Le retrait laisse le depot exactement
dans son etat anterieur : ni pire, ni mieux.

**Le remede, quand ce sera le moment.** Deux options, dans cet ordre.

1. Ajouter un `eslint.config.mjs` **dans ce dossier**, compose depuis les
   paquets deja declares et deja installes : `@typescript-eslint/eslint-plugin`
   et `@typescript-eslint/parser` en 8.71.0, `eslint-plugin-prettier`,
   `eslint-config-prettier`, `eslint` en 10.11.0. Leurs plages de dependances
   sont mutuellement compatibles (le plugin annonce
   `eslint: ^8.57.0 || ^9.0.0 || ^10.0.0` et `typescript: >=4.8.4 <6.1.0`).
   Ne pas activer l'analyse sensible aux types : `test/`, `prisma/` et `src/` ne
   relevent pas du meme programme TypeScript (`tsconfig.json` et
   `tsconfig.e2e.json`), et un fichier hors programme ferait echouer l'analyse.
2. Installer `eslint` a la racine du depot — **a eviter** : cela touche
   l'environnement du frontend, qui appartient a un autre developpeur.

**Le piege a connaitre avant de lancer `--fix`.** Le script porte `--fix`. Le
jour ou la resolution sera corrigee, la premiere execution reecrira les fichiers
analyses selon les regles retenues. Lancez d'abord
`./node_modules/.bin/eslint "{src,test,prisma}/**/*.ts"` **sans** `--fix`, et
lisez le nombre de diagnostics : c'est la seule facon de decider si le jeu de
regles decrit le code existant ou s'il le reecrit.
