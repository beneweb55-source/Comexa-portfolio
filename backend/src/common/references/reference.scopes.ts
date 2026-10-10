/**
 * NUMEROTATION DES REFERENCES — le tableau des portees et de leurs prefixes.
 *
 * C'est la SEULE declaration de ce contrat dans le projet. Ce fichier vit dans
 * `src/common/` pour la meme raison que le catalogue de permissions vit dans
 * `src/common/auth/` : ce n'est pas de la donnee initiale, c'est du DOMAINE.
 * Trois lecteurs s'en servent — `CounterService`, `prisma/seed.ts`, et le spec
 * d'a cote — et les trois doivent lire la MEME constante.
 *
 * -----------------------------------------------------------------------------
 * CE FICHIER NE CONTIENT QUE DES DONNEES
 * -----------------------------------------------------------------------------
 * Aucune fonction, aucun import, aucune dependance. Le formatage
 * (`<PREFIX>-<ANNEE>-<SEQUENCE>`) vit dans `src/modules/counters/reference.ts`,
 * l'attribution atomique d'un numero dans `CounterService`.
 *
 * Ce decoupage n'est pas cosmetique. Le tableau est lu par le seed, qui n'est pas
 * un module Nest et ne peut pas importer de code de service ; inversement
 * `src/common/` est en dessous de `src/modules/` et n'a pas le droit d'en
 * dependre. Seul un fichier de donnees pures est lisible par les deux etages.
 *
 * -----------------------------------------------------------------------------
 * POURQUOI CE FICHIER EXISTE
 * -----------------------------------------------------------------------------
 * Huit modeles portent une colonne `reference` marquee `@unique` et NON
 * nullable : `Prospect`, `Client`, `Project`, `Quote`, `Invoice`, `Payment`,
 * `ContactRequest`, `ModificationRequest`. Chacun doit donc produire une chaine
 * unique, et rien dans le schema n'impose la forme de cette chaine.
 *
 * Laisser chaque module decider du prefixe donne ceci : le prospect cree par le
 * seed porte `PRO-2026-0001`, celui cree par l'API porte `PRS-2026-0001`, et
 * plus personne ne reconnait un prospect a l'oeil dans une liste de references —
 * or c'est la seule raison d'etre d'une reference lisible.
 *
 * -----------------------------------------------------------------------------
 * LA CASSE EST UNE PARTIE DE L'IDENTITE
 * -----------------------------------------------------------------------------
 * La cle primaire de `Counter` est `@@id([scope, year])`. `'PROSPECT'` et
 * `'prospect'` sont donc DEUX LIGNES DIFFERENTES, et non deux orthographes de la
 * meme chose.
 *
 * La consequence est precise et silencieuse : un service qui lirait `'prospect'`
 * trouverait un compteur a 0, renverrait `PRO-2026-0001`, et se heurterait a la
 * reference que le seed a deja posee. L'erreur remonterait en violation
 * d'unicite Prisma — c'est-a-dire a un endroit qui ne parle ni de casse ni de
 * numerotation. D'ou des valeurs en MAJUSCULES et une seule declaration.
 * (`CounterService` normalise en plus la casse qu'on lui passe, pour que
 * `'client'` et `'CLIENT'` retombent sur la meme ligne.)
 */

/**
 * Portees de numerotation. CES CHAINES SONT UN CONTRAT.
 *
 * Elles sont ecrites telles quelles dans `Counter.scope`. Renommer une portee
 * renomme un compteur : la ligne existante devient orpheline et la numerotation
 * repart a 0001 sur le nouveau nom, ce qui reproduit exactement la collision
 * d'unicite decrite plus haut. Une portee ne se renomme pas, elle s'ajoute.
 */
export const REFERENCE_SCOPES = {
  PROSPECT: 'PROSPECT',
  CLIENT: 'CLIENT',
  PROJECT: 'PROJECT',
  QUOTE: 'QUOTE',
  INVOICE: 'INVOICE',
  PAYMENT: 'PAYMENT',
  CONTACT_REQUEST: 'CONTACT_REQUEST',
  MODIFICATION_REQUEST: 'MODIFICATION_REQUEST',
  ORDER: 'ORDER',
  PROJECT_REQUEST: 'PROJECT_REQUEST',
} as const;

export type ReferenceScope = (typeof REFERENCE_SCOPES)[keyof typeof REFERENCE_SCOPES];

/**
 * Prefixe imprime de chaque portee : `PROSPECT` -> `PRO-2026-0001`.
 *
 * Les prefixes sont volontairement courts, parce qu'ils apparaissent sur des
 * documents que des humains se transmettent : `DEV-2026-0001` doit se lire
 * « devis » sans legende.
 *
 * `PRO` et `CLI` ne sont pas negociables : `prisma/seed.ts` ecrit deja
 * `PRO-2026-0001` et `CLI-2026-0001`. Les changer ici produirait deux formats
 * pour la meme entite selon qu'elle vient du seed ou de l'API — la rupture
 * precise que ce fichier existe pour empecher. Le spec d'a cote le verifie.
 */
export const REFERENCE_PREFIXES: Record<ReferenceScope, string> = {
  PROSPECT: 'PRO',
  CLIENT: 'CLI',
  PROJECT: 'PRJ',
  QUOTE: 'DEV',
  INVOICE: 'FAC',
  PAYMENT: 'PAY',
  CONTACT_REQUEST: 'CTR',
  MODIFICATION_REQUEST: 'MOD',
  ORDER: 'CMD',
  PROJECT_REQUEST: 'DEM',
};

/**
 * Largeur de la sequence : `4` donne `0001`, et tient jusqu'a 9999 documents
 * par portee et par an.
 *
 * Declaree ici, avec les portees et les prefixes, parce que c'est la meme
 * nature d'information : une politique de numerotation, lue par les appelants.
 * `src/modules/counters/reference.ts` ne fait que l'ASSEMBLER en chaine ; il
 * importe cette constante et ne redeclare pas un second `4`.
 *
 * Au-dela de 9999, la sequence s'allonge (`10000`) au lieu d'etre tronquee :
 * `padStart` n'ecrit que des zeros de tete, et tronquer ferait collisionner
 * toute la fin de l'annee.
 */
export const REFERENCE_PADDING = 4;
