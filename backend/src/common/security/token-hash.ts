import { createHash, randomBytes } from 'node:crypto';

/**
 * Jetons opaques et leur empreinte.
 *
 * Un refresh token et un jeton de reinitialisation ne sont PAS des JWT : ils ne
 * portent aucune donnee, ils sont juste un secret aleatoire que la base sait
 * reconnaitre. Un JWT se verifie hors ligne, donc un jeton revoque reste valable
 * jusqu'a son expiration ; un jeton opaque se verifie en base, donc revoquer
 * coupe l'acces immediatement. C'est exactement ce qu'on veut d'une session
 * longue duree.
 *
 * On ne stocke que l'EMPREINTE (SHA-256). La consequence pratique : une fuite de
 * la table `refresh_tokens` ne permet pas de rejouer une session, seulement de
 * constater qu'il en existait une. Une base de donnees se sauvegarde, se copie
 * vers un environnement de recette, se lit dans un `pg_dump` — le secret en
 * clair, lui, ne doit exister que chez son porteur.
 *
 * SHA-256 nu, sans sel, est le bon choix ici, contrairement a un mot de passe :
 * la valeur d'entree fait 48 octets aleatoires, donc les tables precalculees et
 * les attaques par dictionnaire n'ont rien a mordre, et il n'y a pas de
 * « mot de passe frequent » a proteger.
 */

/** 48 octets = 384 bits. Tres au-dela de ce qu'on sait forcer. */
export const OPAQUE_TOKEN_BYTES = 48;

/**
 * Genere un secret opaque.
 *
 * `base64url` et non `hex` : 48 octets donnent 64 caracteres au lieu de 96, et
 * le resultat passe tel quel dans une URL, un cookie ou un en-tete sans
 * encodage supplementaire.
 */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/** Empreinte hexadecimale d'un jeton, telle qu'elle est stockee en base. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
