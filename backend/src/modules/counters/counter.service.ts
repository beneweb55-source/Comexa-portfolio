import { Injectable } from '@nestjs/common';
import { REFERENCE_PREFIXES } from '../../common/references/reference.scopes.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_SEQUENCE_DIGITS, formatReference, referenceYear } from './reference.js';

// Reexport : la table a demenage dans `src/common/references/reference.scopes.ts`
// (couche partagee, que `prisma/seed.ts` peut importer sans dependre d'un module
// Nest), mais des appelants l'importaient deja d'ici. Le reexport evite de les
// casser et laisse UNE source de verite : ce fichier ne redeclare rien.
export { REFERENCE_PREFIXES };

/**
 * NUMEROTATION DES DOCUMENTS — le service le plus court du module, et celui qui
 * casse le plus silencieusement quand il est mal ecrit.
 *
 * LE PROBLEME. Deux commercants creent un devis a la meme seconde. Le code naif
 * — lire `value`, ajouter 1, ecrire — donne a tous les deux le numero 42 : les
 * deux transactions lisent 42 avant que l'une des deux n'ecrive 43. Le resultat
 * n'est pas une erreur propre, c'est une violation de contrainte d'unicite sur
 * `quotes.reference` remontee a l'utilisateur sous forme de 500, ou pire, deux
 * documents portant la meme reference legale.
 *
 * LA SOLUTION. `UPDATE counters SET value = value + 1 RETURNING value` (ce
 * qu'ecrit Prisma pour `{ increment: 1 }`) est UNE instruction. PostgreSQL
 * verrouille la ligne, incremente, renvoie la valeur, et la deuxieme transaction
 * attend puis lit la valeur SUIVANTE. Le calcul est fait par le moteur, pas par
 * le processus applicatif : il n'y a pas de fenetre entre la lecture et
 * l'ecriture, parce qu'il n'y a pas de lecture.
 *
 * POURQUOI UN `upsert` AVANT. La ligne `(scope, year)` n'existe pas encore la
 * premiere fois de l'annee. `upsert` avec un `update` vide est l'idiome Prisma du
 * « creer si absent », et `update: {}` est volontairement vide : y ecrire la
 * valeur remettrait la numerotation a zero a chaque appel concurrent.
 *
 * LE FILET DE SECURITE EST EN BASE. `quotes.reference`, `invoices.reference`,
 * `payments.reference`, `clients.reference` et `projects.reference` portent une
 * contrainte UNIQUE (verifie dans la migration `20260928234223_init`). Si ce
 * service se trompait un jour, l'insertion echouerait au lieu d'ecrire un
 * doublon. Un compteur applicatif sans contrainte en base n'est qu'une
 * convention ; avec la contrainte, c'est une garantie.
 *
 * UN SERVICE PUBLIC, PAS UN DETAIL INTERNE. Le client, le projet, le devis, la
 * facture et le paiement sont numerotes par ce meme service : deux
 * implementations paralleles, ou une lecture-puis-ecriture locale, produiraient
 * tot ou tard deux fois la meme reference. C'est pourquoi la surface publique se
 * limite a `next` et `reference`, et pourquoi les appelants ne calculent JAMAIS
 * une reference eux-memes.
 */

/**
 * Ce qu'un appelant demande : une portee, et eventuellement des exceptions.
 *
 * `scope` est une `string` LIBRE et non une union fermee : les modules client et
 * projet ouvrent leurs propres portees ('CLIENT', 'PROJECT') sans avoir a
 * modifier ce fichier. Une union fermee obligerait chaque nouveau domaine a
 * editer le compteur, donc a recreer un point de couplage entre modules.
 */
export interface CounterStamp {
  /** 'CLIENT', 'PROJECT', 'QUOTE', 'INVOICE', 'PAYMENT'... Voir `REFERENCE_PREFIXES`. */
  scope: string;
  /** Annee de la sequence. Defaut : l'annee civile courante. */
  year?: number;
  /** Prefixe imprime. Defaut : celui de `REFERENCE_PREFIXES`. A n'utiliser qu'en exception. */
  prefix?: string;
  /** Nombre de chiffres de la sequence. Defaut : `DEFAULT_SEQUENCE_DIGITS` (4). */
  padding?: number;
}

/**
 * LA TABLE PORTEE -> PREFIXE VIT DESORMAIS DANS `src/common/`, et ce fichier la
 * lit sans la redeclarer : `src/common/references/reference.scopes.ts`.
 *
 * Elle y est pour une raison de sens de dependance : `src/common/` est la couche
 * partagee, `src/modules/counters/` est un module metier, et surtout
 * `prisma/seed.ts` doit lire la meme table que le service. Le seed peut importer
 * `src/common/` ; il n'a pas a importer un module Nest pour connaitre un prefixe.
 *
 * Les portees y sont en MAJUSCULES parce que la cle primaire de `counters` est
 * `@@id([scope, year])` : `'client'` et `'CLIENT'` sont DEUX lignes distinctes.
 * Le seed ecrit `PROSPECT` / `CLIENT` et pose `value: 1` apres avoir cree
 * `PRO-2026-0001` et `CLI-2026-0001` ; un service qui chercherait `'client'`
 * lirait 0, renverrait `CLI-2026-0001` — deja pris — et echouerait sur une
 * violation d'unicite a la premiere creation. C'est pourquoi `canonicalScope`
 * met la portee en majuscules : les deux orthographes retombent sur la MEME
 * ligne, et la tolerance a la casse ne coute aucun numero.
 *
 * `prefix` reste dans `CounterStamp` comme parametre de SURCHARGE, pour un cas
 * exceptionnel (reprise d'historique, portee ouverte par un script). Les
 * appelants normaux ne passent que `scope` : le prefixe est alors celui de la
 * table commune.
 */

/** Portee normalisee : `' client '` et `'client'` donnent tous deux `'CLIENT'`. */
export function canonicalScope(scope: string): string {
  return scope.trim().toUpperCase();
}

/**
 * Vue elargie de la table, pour une portee LIBRE.
 *
 * `REFERENCE_PREFIXES` est type `Record<ReferenceScope, string>` : c'est le
 * contrat, et il doit rester etroit (une portee oubliee doit se voir a la
 * compilation). Mais `CounterStamp.scope` est une `string` OUVERTE, par decision
 * explicite : un module voisin doit pouvoir ouvrir sa propre portee sans editer
 * ces deux fichiers. Lire une table etroite avec une cle large demande donc un
 * elargissement local, et c'est le seul du fichier.
 */
function prefixTable(): Readonly<Record<string, string | undefined>> {
  return REFERENCE_PREFIXES;
}

/** Prefixe d'une portee : la surcharge si elle est fournie, sinon la table. */
export function stampPrefix(scope: string, override?: string): string {
  if (override !== undefined && override.trim().length > 0) {
    return override.trim().toUpperCase();
  }

  const known = prefixTable()[canonicalScope(scope)];

  if (known !== undefined) {
    return known;
  }

  // Portee inconnue : on derive les trois premieres lettres plutot que de
  // refuser. Une portee libre n'a d'interet que si elle fonctionne sans passer
  // par une modification de ces fichiers — mais l'appelant qui invente une
  // portee en assume le prefixe, et il vaut mieux qu'il le passe explicitement.
  const canonical = canonicalScope(scope);
  const letters = canonical.replace(/[^A-Z0-9]/g, '');
  return letters.length >= 3 ? letters.slice(0, 3) : letters.padEnd(3, 'X');
}

/**
 * Un timbre resolu : toutes les valeurs deja fixees.
 *
 * Existe pour qu'une creation de document resolve UNE SEULE FOIS l'annee, puis
 * s'en serve a la fois pour la ligne `counters` et pour la chaine imprimee. Si
 * `next` et le formatage resolvaient l'annee chacun de leur cote, un appel a
 * cheval sur le 31 decembre a 23:59:59 reserverait le numero 2026 pendant que la
 * reference afficherait 2027 — un document date d'une annee dont la sequence
 * n'est pas la sienne.
 *
 * Un `ResolvedStamp` satisfait `CounterStamp` : rien n'empeche de le repasser a
 * `next`, qui le resoudra a l'identique.
 */
export interface ResolvedStamp {
  readonly scope: string;
  readonly year: number;
  readonly prefix: string;
  readonly padding: number;
}

/** Fige les valeurs par defaut d'un timbre. Idempotent. */
export function resolveStamp(stamp: CounterStamp): ResolvedStamp {
  return {
    scope: canonicalScope(stamp.scope),
    year: stamp.year ?? referenceYear(),
    prefix: stampPrefix(stamp.scope, stamp.prefix),
    padding:
      stamp.padding !== undefined && Number.isFinite(stamp.padding) && stamp.padding >= 1
        ? Math.trunc(stamp.padding)
        : DEFAULT_SEQUENCE_DIGITS,
  };
}

/**
 * Formate la reference d'un numero DEJA reserve.
 *
 * C'est la seule autre porte d'entree du formatage, et elle existe pour les
 * pieces qui doivent persister la sequence et l'annee a cote de la reference
 * (`quotes.sequence`, `quotes.year`, idem `invoices`) : ces appelants reservent
 * avec `next` puis formatent ici, au lieu d'appeler `reference` puis de
 * re-analyser la chaine obtenue. Une seule fonction d'assemblage, donc aucun
 * risque que `next` + ce formatage divergent de `reference`.
 *
 * Prenez l'objet renvoye par `resolveStamp` et passez-LE MEME a `next` et ici.
 */
export function stampReference(stamp: ResolvedStamp, sequence: number): string {
  return formatReference(stamp.prefix, stamp.year, sequence, stamp.padding);
}

/** Client Prisma ou transaction en cours. `tx` n'a qu'a exposer `counter`. */
type CounterDb = Pick<Prisma.TransactionClient, 'counter'>;

@Injectable()
export class CounterService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserve le prochain numero de la portee, et renvoie la valeur BRUTE.
   *
   * A n'appeler QUE si l'appelant doit stocker la sequence et l'annee (colonnes
   * `sequence` / `year` de `quotes` et `invoices`). Pour une piece qui ne porte
   * qu'une reference (`clients`, `projects`, `payments`), `reference` suffit et
   * evite de reconstruire la chaine.
   *
   * `next` et `reference` RESERVENT CHACUN UN NUMERO : les appeler tous les deux
   * pour le meme document consomme deux numeros et laisse un trou. Le trou est
   * sans gravite legale — une sequence comptable peut sauter — mais il est
   * inutile, et un trou inexplique dans une numerotation legale se remarque.
   *
   * `tx` est optionnel pour que le service reste utilisable hors requete HTTP
   * (script, migration). En revanche, tout appel qui vit dans une transaction
   * DOIT passer son `tx` : la reservation rejoint alors la transaction du
   * document, et un echec plus loin annule les deux ensemble. Sans `tx`, un
   * rollback ulterieur brule le numero — jamais de doublon, mais un saut.
   */
  async next(stamp: CounterStamp, tx?: Prisma.TransactionClient): Promise<number> {
    return this.reserve(stamp, tx);
  }

  /**
   * Reserve le prochain numero, et renvoie la reference imprimee :
   * `CLI-2026-0001`, `DEV-2026-0007`.
   *
   * C'est la methode que les appelants normaux utilisent. Ils ne passent que
   * `scope` : le prefixe vient de `REFERENCE_PREFIXES`.
   */
  async reference(stamp: CounterStamp, tx?: Prisma.TransactionClient): Promise<string> {
    const resolved = resolveStamp(stamp);
    const sequence = await this.reserve(resolved, tx);
    return stampReference(resolved, sequence);
  }

  /**
   * Reservation atomique, partagee par `next` et `reference`.
   *
   * Privee : personne d'autre que ces deux methodes ne doit pouvoir consommer un
   * numero, parce que c'est ici que se trouve l'unique instruction qui garantit
   * l'unicite sous concurrence.
   */
  private async reserve(stamp: CounterStamp, tx?: Prisma.TransactionClient): Promise<number> {
    const resolved = resolveStamp(stamp);
    const db: CounterDb = tx ?? this.prisma;

    // 1. La ligne de l'annee existe, ou elle est creee a zero.
    await db.counter.upsert({
      where: { scope_year: { scope: resolved.scope, year: resolved.year } },
      create: { scope: resolved.scope, year: resolved.year, value: 0 },
      update: {},
    });

    // 2. L'increment atomique EN BASE. La valeur renvoyee est celle qui vient
    //    d'etre incrementee : c'est la seule qui soit a l'abri d'un doublon.
    //    Un `findUnique` suivi d'un `update` rouvrirait exactement la fenetre
    //    que ce service existe pour fermer.
    const counter = await db.counter.update({
      where: { scope_year: { scope: resolved.scope, year: resolved.year } },
      data: { value: { increment: 1 } },
      select: { value: true },
    });

    return counter.value;
  }
}
