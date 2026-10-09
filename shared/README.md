# shared/ — le contrat de l'API, cote frontend

Types de la reponse HTTP de l'API Comexa, sans aucune dependance. Le backend
vit dans `backend/` ; ce dossier-ci existe pour que le frontend n'ait jamais a
importer quoi que ce soit de Nest ou de Prisma.

| Fichier | Contenu |
|---|---|
| `api/envelope.ts` | Forme de la reponse : succes, erreur, pagination, limites. |
| `api/error-codes.ts` | Les valeurs de `error.code` : 18 codes generaux, 137 codes de ressource. |
| `api/openapi.json` | Le contrat complet, **genere depuis le code** : 112 chemins, 165 operations. |

---

## Pourquoi une copie, et non un import du backend

Les declarations existent deja dans le backend. Elles n'y sont pas
importables depuis le frontend pour deux raisons mecaniques :

1. `transform.interceptor.ts` et `app-error.ts` importent `@nestjs/common`.
   Les importer depuis un composant client entrainerait le framework serveur
   dans le bundle du navigateur.
2. Le backend compile `src/` vers `dist/` : un fichier de `src/` qui importerait
   hors de `src/` casserait la disposition de sortie de `tsc`. La dependance ne
   peut donc pas aller dans ce sens non plus.

D'ou une copie assumee, avec une regle qui la rend sure :

> **En cas de desaccord, LE BACKEND A RAISON.** Chaque fichier porte en tete la
> liste des fichiers source dont il est le miroir, et `error-codes.ts` contient
> la commande qui regenere sa liste. Une modification cote backend se repercute
> ici a la main — c'est le prix de l'isolation, et il est faible : ce sont des
> formes qui bougent rarement.

## `api/openapi.json` — le contrat complet, et il est genere

Les deux fichiers ci-dessus sont ecrits a la main. Celui-la ne l'est pas : il est
**produit par le code**, puis committe tel quel. Il decrit les 165 operations de
l'API — chemins, parametres, corps attendus, formes des reponses — ainsi que les
DTO, les enums du domaine et les codes de permission. C'est donc lui qui repond a
tout ce que ce dossier ne contient pas.

```bash
cd backend
npm run openapi:export
```

> **CE FICHIER N'EST PAS SERVI EN LIGNE PAR DEFAUT, ET C'EST VOULU.** `/api/docs`
> ne sert le document que hors production : sur le service deploye, il repond
> **404** — sauf si `DOCS_ENABLED=true`, auquel cas la documentation est servie,
> mais **derriere un mot de passe** (`DOCS_USER` / `DOCS_PASSWORD`), saisi dans une
> page de connexion servie par le serveur : aucun reglage du navigateur, aucune
> fenetre privee. C'est une
> decision de securite : un plan detaille de l'API, publie, aide surtout a la
> cartographier, et ce depot refuse qu'on puisse le publier par accident — le
> serveur ne demarre pas si le drapeau est ouvert sans identifiants. Le document
> vit donc d'abord dans le depot, ou il est versionne et lisible par quiconque
> clone. En local, `npm run start:dev` sert le meme document
> sur `/api/docs`, avec Swagger UI pour l'explorer — le meme au sens strict : les
> deux passent par la CLI Nest, seule a appliquer le plugin Swagger de
> `nest-cli.json`. Ce plugin lit les decorateurs class-validator et recopie leurs
> bornes dans le schema (`@MaxLength` -> `maxLength`, `@Min` -> `minimum`,
> `@IsEmail` -> `format: email`), en plus de resoudre le type reel des champs
> optionnels. Un `tsc` nu produit donc un document plus pauvre : mesure, 463
> feuilles en moins, 46 valeurs fausses — dont 45 types ecrits `object` — et 67
> operations sur 165 concernees. Le detail est dans `backend/docs/TESTING.md`.

Le tenir a jour ne repose pas sur la discipline, contrairement aux deux autres :
`backend/test/docs.e2e-spec.ts` compare ce fichier a la sortie fraiche de
`configureApp` et **echoue** s'il a pris du retard, en nommant les operations et
les schemas concernes. Un DTO modifie sans relancer l'export fait donc tomber la
suite e2e —
ce qui est exactement le moment ou l'on veut l'apprendre, et non celui ou
quelqu'un integre un contrat perime.

## Comment consommer

Le frontend est a la racine du depot. `jsconfig.json` ne declare aujourd'hui
qu'un alias :

```json
{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }
```

Deux facons de s'en servir, au choix :

- **Alias** — ajouter une ligne a `jsconfig.json`, puis
  `import type { ApiSuccessBody } from '@comexa/shared/api/envelope';`
  ```json
  "@comexa/shared/*": ["./shared/*"]
  ```
- **Copie** — recopier les deux fichiers ecrits a la main dans `src/lib/api/` si
  l'on prefere que tout le code du frontend vive sous `src/`. Le contenu est
  autonome, il n'y a rien a adapter. `api/openapi.json` ne se recopie pas : il
  s'ouvre, ou il alimente un generateur de client.

Aucune des deux n'est prise par defaut : le proprietaire du frontend choisit sa
convention, et ce dossier ne la lui impose pas.

## Ce qui n'est PAS ici, et pourquoi

- **Les formes de chaque DTO** (projet, devis, facture, ...). Elles sont dans
  `api/openapi.json`, juste a cote. Les recopier a la main creerait quarante
  occasions de derive pour un gain nul : un generateur de client les produit a
  partir du document, et le document est verifie par un test.
- **Les codes de permission** (`project:write:any`, ...). Le frontend ne les
  devine pas : il les recoit a l'authentification et les teste a l'execution.
  Une union fermee ici deviendrait fausse au premier role ajoute.
- **Les enums du domaine** (statuts de devis, de facture, de tache). Ils sont
  dans le schema OpenAPI, qui est la source.

Ce dossier contient donc, ecrits a la main, les deux seules choses qu'OpenAPI
**ne sait pas dire** : l'enveloppe qui entoure chaque reponse, et la liste des
codes d'erreur. Et, a cote d'elles, le document OpenAPI lui-meme — le seul des
trois qu'aucune main ne touche.
