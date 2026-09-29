# shared/ — le contrat de l'API, cote frontend

Types de la reponse HTTP de l'API Comexa, sans aucune dependance. Le backend
vit dans `backend/` ; ce dossier-ci existe pour que le frontend n'ait jamais a
importer quoi que ce soit de Nest ou de Prisma.

| Fichier | Contenu |
|---|---|
| `api/envelope.ts` | Forme de la reponse : succes, erreur, pagination, limites. |
| `api/error-codes.ts` | Les valeurs de `error.code` : 18 codes generaux, 137 codes de ressource. |

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
- **Copie** — recopier les deux fichiers dans `src/lib/api/` si l'on prefere
  que tout le code du frontend vive sous `src/`. Le contenu est autonome, il
  n'y a rien a adapter.

Aucune des deux n'est prise par defaut : le proprietaire du frontend choisit sa
convention, et ce dossier ne la lui impose pas.

## Ce qui n'est PAS ici, et pourquoi

- **Les formes de chaque DTO** (projet, devis, facture, ...). Elles sont
  decrites par OpenAPI, genere depuis le code et servi sur `/api/docs`. Les
  recopier ici creerait quarante occasions de derive pour un gain nul : un
  client OpenAPI les produit.
- **Les codes de permission** (`project:write:any`, ...). Le frontend ne les
  devine pas : il les recoit a l'authentification et les teste a l'execution.
  Une union fermee ici deviendrait fausse au premier role ajoute.
- **Les enums du domaine** (statuts de devis, de facture, de tache). Ils sont
  dans le schema OpenAPI, qui est la source.

Ce dossier ne contient donc que ce qu'OpenAPI **ne sait pas dire** : l'enveloppe
qui entoure chaque reponse, et la liste des codes d'erreur.
