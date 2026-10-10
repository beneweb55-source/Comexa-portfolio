# Audit des dependances

Etat au 29 septembre 2026, sur `backend/package.json`.

    npm audit --audit-level=moderate

    deepmerge-ts  <8.0.0        high
    mysql2        <=3.23.0      high
    4 high severity vulnerabilities

## La conclusion d'abord

**Ces vulnerabilites ne sont pas corrigees, et c'est un choix.** Le correctif
propose par `npm audit` est pire que le defaut.

    npm audit fix --force
    Will install prisma@6.19.3, which is a breaking change

Le projet est sur `prisma@7.10.0`. La « correction » consiste donc a revenir a
une version MAJEURE anterieure, ce qui casserait :

- `prisma.config.ts`, dont le format n'existe qu'a partir de Prisma 7 (en
  Prisma 6 l'URL de connexion et le chemin de seed vivent ailleurs) ;
- les adaptateurs de pilote (`@prisma/adapter-pg`), le mode de connexion retenu
  pour Neon ;
- le generateur `prisma-client` et l'emplacement `src/generated/` dont depend
  tout le code compile.

Echanger quatre vulnerabilites dans une chaine d'outils de developpement contre
une regression du coeur de l'acces aux donnees serait une mauvaise affaire. La
bonne reponse est d'attendre une version corrigee de Prisma 7, et de verifier
regulierement :

    npm audit --audit-level=moderate

## Les deux avis, un par un

### deepmerge-ts < 8.0.0 — epuisement de pile

    GHSA-ggr8-5vv4-36mx
    Chemin : prisma > @prisma/config > deepmerge-ts

Fusionner un graphe d'objets recursif epuise la pile.

**Pourquoi l'exposition est nulle en production.** `deepmerge-ts` n'est pas une
dependance de l'API : elle n'est atteignable que par la CLI Prisma. Or l'image
d'execution est construite avec `npm ci --omit=dev` (voir `Dockerfile`, etape
`prod-deps`), et `prisma` est une `devDependency`. Le paquet n'est donc **pas
present dans l'image qui sert le trafic**. Ce n'est pas une supposition : c'est
la consequence directe du `--omit=dev`, et c'est verifiable avec

    docker run --rm comexa-backend ls node_modules | grep deepmerge   # rien

**Ou l'exposition subsiste.** Le service `migrate` de `docker-compose.yml` est
construit depuis l'etape `build`, qui contient la CLI. La saisie y est un
`schema.prisma` et des fichiers de migration — tous deux versionnes dans le
depot, relus en revue. Il faudrait donc un commit malveillant dans le depot pour
atteindre le defaut, et a ce stade le depot est deja compromis.

### mysql2 <= 3.23.0 — downgrade d'authentification, bombe de decompression

    GHSA-3f6p-5ww8-9rcr, GHSA-rgwj-5xj2-c3m3

**Cette dependance n'est pas utilisee par ce projet.** `mysql2` est un pilote
optionnel que la CLI Prisma embarque pour les bases MySQL. L'application se
connecte a PostgreSQL par `@prisma/adapter-pg` et `pg`. Aucune chaine de
connexion MySQL n'existe dans le projet, aucune ne peut y entrer : le schema
declare `provider = "postgresql"`.

Les deux avis portent sur le protocole MySQL — un canal qui n'est jamais ouvert
ici. Le risque n'est donc pas seulement attenue : il est absent.

## Risque residuel, et ce qui le borne

| Avis | Present au runtime ? | Atteignable par une entree utilisateur ? |
|---|---|---|
| `deepmerge-ts` | Non (`--omit=dev`) | Non — schema et migrations versionnes |
| `mysql2` | Non (`--omit=dev`) | Non — aucun chemin MySQL dans le projet |

Le risque se reduit a : **un developpeur qui lance la CLI Prisma sur une entree
non fiable**. Autrement dit une migration ecrite a la main a partir d'une source
externe, ou un `prisma db pull` contre une base tierce. Aucun des deux ne fait
partie du cycle de travail normal.

## Ce qu'il faut faire, et quand

1. **Ne pas lancer `npm audit fix --force`.** Ce paragraphe est ici pour que
   personne ne le fasse « pour faire disparaitre l'avertissement » : il
   downgraderait Prisma et casserait l'application.
2. **Reevaluer a chaque montee de version de Prisma.** Les deux avis viennent de
   la meme chaine : une version de `@prisma/config` qui embarque
   `deepmerge-ts@8` et retire `mysql2` les eteint tous les quatre. C'est une
   mise a jour mineure, pas un chantier.
3. **Verifier apres chaque build d'image** que l'etape `prod-deps` fait bien son
   travail — c'est elle, et non `npm audit`, qui protege la production ici.

## Ce que cet audit ne couvre pas

`npm audit` interroge une base d'avis publics sur des versions de paquets. Il ne
dit rien de :

- la configuration applicative (CORS, en-tetes, cookies, limitation de debit) —
  voir `src/app.setup.ts` et `src/config/env.validation.ts` ;
- les regles d'autorisation metier — voir `src/common/auth/` et le catalogue de
  permissions ;
- les secrets : leur presence dans l'historique se controle avec
  `git log -p -- .env` et non avec `npm audit`.

Ces trois-la pesent plus lourd que les quatre avis ci-dessus, et aucun outil ne
les verifie a la place d'une relecture.
