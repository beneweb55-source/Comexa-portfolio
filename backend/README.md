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
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` | **L'un des deux chemins est obligatoire en production** : le serveur refuse de demarrer sans. C'est celui a preferer — l'API HTTP passe par le port 443, jamais filtre, la ou plusieurs hebergeurs gratuits bloquent les ports SMTP 25, 465 et 587. **Les deux cles vont ensemble** : Mailjet authentifie en HTTP Basic, et une cle seule donne un `401` a chaque envoi. |
| `SMTP_HOST` | L'autre chemin, pour une machine qui n'est pas derriere un filtrage SMTP. **L'un des deux suffit, jamais les deux par precaution.** Le parcours « mot de passe oublie » repond toujours 200 pour ne pas reveler quels comptes existent ; cette reponse n'est honnete que si le courriel part reellement. En developpement, laissez les deux vides : le lien est ecrit dans les journaux. |
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
| `docs/DEPLOYMENT.md` | Le runbook de mise en production : VM, TLS, stockage objet, courriel. |
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

### En production

`docker-compose.yml` est la pile de **developpement** : base PostgreSQL jetable
et MinIO en local, avec des variables `COMEXA_*` qui ne peuvent pas etre
renseignees par accident. La production utilise un fichier distinct :

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Deux conteneurs seulement — l'API et **Caddy**, qui termine le TLS et obtient son
certificat Let's Encrypt tout seul. La base est Neon, les fichiers sont dans un
stockage S3-compatible, et les deux viennent de `.env.production` (ignore par
git). `--profile tools` met a part `migrate` et `seed` : une migration doit
rester un geste delibere, jamais un effet de bord d'un redemarrage.

> **Pourquoi une VM toujours allumee et pas une plateforme serverless.**
> `InvoiceOverdueService` porte un `@Cron(EVERY_HOUR)`, la passerelle socket.io
> garde des connexions ouvertes, et le limiteur de debit tient son etat en
> memoire vive. Une plateforme qui endort les services fait taire le cron, coupe
> les sockets ; deux instances doublent la limite reelle. Le detail du choix et
> les mesures qui l'ont motive sont dans `docs/DEPLOYMENT.md`.

---

## 7. `npm run lint`

```bash
npm run lint    # eslint "{src,test,prisma}/**/*.ts" --fix
```

**Il fonctionne, et sort propre sur tout l'arbre.** Mesure du 29/09/2026 :
`./node_modules/.bin/eslint "{src,test,prisma}/**/*.ts"` sort en code `0`, sans
un seul diagnostic.

C'est possible parce que ce dossier porte desormais son propre
`eslint.config.mjs`. Sans ce fichier, ESLint ne trouvait aucune configuration
locale et remontait jusqu'a celle du **frontend**, dont les imports
(`eslint/config`, `eslint-config-next`) ne se resolvent pas ici : la racine du
depot n'a pas de `node_modules`. D'ou l'ancien
`ERR_MODULE_NOT_FOUND: Cannot find package 'eslint'`.

### Ce que la configuration ne fait pas

Elle n'affaiblit rien, et c'est **verifie plutot qu'affirme** : un local
inutilise qui ne porte pas le prefixe `_` fait toujours echouer la commande. Un
seul reglage a ete ajuste, `@typescript-eslint/no-unused-vars`, pour tolerer les
noms prefixes par `_` (`argsIgnorePattern`, `varsIgnorePattern`,
`caughtErrorsIgnorePattern`, `ignoreRestSiblings`). Ce n'est pas une
echappatoire : ce depot nomme `_` huit parametres volontairement inutilises —
signature d'interface des pilotes de stockage, parametre decore `@Query()` qui
n'existe que pour la validation, et l'idiome d'omission
`const { x: _x, ...rest } = obj`.

### Deux pieges de forme, tous les deux mesures

Ils sont documentes en tete de `eslint.config.mjs` et valent d'etre connus avant
d'y toucher :

1. Un commentaire **de bloc** ne peut pas citer le glob du script `lint` : la
   sequence `*/` qu'il contient ferme le commentaire au milieu. La premiere
   version du fichier etait invalide pour cette raison exacte.
2. `tseslint.configs['flat/base']` est un **objet**, mais
   `configs['flat/recommended']` est un **tableau de 3** qui doit etre deploye
   (`...`). Pose comme element unique, il forme un tableau imbrique et ESLint
   refuse la configuration entiere : `TypeError: Unexpected array`.

`src/generated/` est ignore : c'est le client Prisma, un artefact derive,
regenere par `prisma:generate`. Le reformater ne produirait qu'un diff efface a
la generation suivante.

### Le piege du `--fix`

Le script porte `--fix`. Sur un arbre propre, c'est sans effet. Mais si vous
modifiez les regles, lancez d'abord la commande **sans** `--fix` :

```bash
./node_modules/.bin/eslint "{src,test,prisma}/**/*.ts"
```

et lisez le nombre de diagnostics. C'est la seule facon de decider si un jeu de
regles decrit le code existant ou s'il le reecrit.
