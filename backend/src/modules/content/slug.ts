import { AppException } from '../../common/errors/app-error.js';

/**
 * LES SLUGS DES CONTENUS PUBLICS — la partie pure.
 *
 * `Service.slug`, `Package.slug`, `CaseStudyCategory.slug` et `CaseStudy.slug`
 * sont `String @unique` NON nullable. Deux consequences, et la seconde est celle
 * qui se paie en production :
 *
 *  1. un contenu sans slug ne peut pas exister, donc le slug se derive du nom
 *     quand l'appelant n'en fournit pas ;
 *  2. deux contenus qui portent le meme nom produisent le meme slug, et la
 *     seconde creation echoue sur une contrainte d'unicite.
 *
 * LE CHOIX, ET IL EST DELIBERE : on REFUSE avec un 409 explicite, on ne suffixe
 * pas automatiquement.
 *
 * Le reflexe — ajouter `-2` jusqu'a trouver un libre — produit une URL que
 * personne n'a choisie : l'editeur croit publier « Etude de cas » et obtient
 * `/etudes-de-cas/etude-de-cas-2`. Le numero ne veut rien dire, il change si
 * l'on renomme l'autre contenu, et il transforme une erreur de saisie en une
 * URL definitivement laide — or un slug public ne se change pas sans casser les
 * liens entrants ni le referencement. Un refus nomme le champ en conflit : le
 * message dit quoi corriger, et l'editeur choisit son URL.
 *
 * Le controle est fait AVANT l'insertion pour produire ce message. La course
 * entre la verification et l'ecriture reste possible — deux creations
 * simultanees du meme nom — et c'est la contrainte `@unique` de PostgreSQL qui
 * la tranche ; le service traduit alors la violation Prisma en meme refus, pour
 * que l'appelant ne voie jamais un 500 la ou il y a un conflit de nom.
 */

/** Longueur maximale d'un slug. Borne la colonne et l'URL. */
export const SLUG_MAX_LENGTH = 80;

/**
 * Slugs refuses.
 *
 * Un slug public devient un segment d'URL. « admin », « api » ou « login » sous
 * le prefixe des contenus creeraient un chemin qui ressemble a une route de
 * l'application, et le frontend resoudrait `/<prefixe>/admin` avant d'atteindre
 * la page du contenu — ou l'inverse, selon l'ordre des routes. Le conflit ne se
 * voit qu'au moment ou quelqu'un cree le contenu, c'est-a-dire trop tard.
 */
const RESERVED_SLUGS: readonly string[] = Object.freeze([
  'admin',
  'api',
  'auth',
  'login',
  'logout',
  'register',
  'public',
  'static',
  'sitemap',
  'robots',
]);

/**
 * Transforme un libelle en slug.
 *
 * La decomposition NFD separe la lettre de son accent, et la plage U+0300–U+036F
 * retire les diacritiques : « Etude de cas » et « Étude de cas » donnent le meme
 * slug. Sans cela, deux contenus dont le titre ne differe que par un accent
 * produiraient deux slugs differents, dont l'un serait invisible a l'oeil — et
 * le `@unique` ne le verrait pas non plus, puisqu'ils sont bien distincts.
 *
 * Tout ce qui n'est ni lettre ASCII ni chiffre devient un separateur, et les
 * separateurs successifs sont fusionnes : « Pack   Premium !! » donne
 * `pack-premium`, et non `pack---premium-`.
 */
export function slugify(value: string): string {
  // La seconde expression retire la plage des diacritiques combinants
  // (U+0300 a U+036F) que NFD vient de detacher de leur lettre.
  const ascii = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

  return ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    // La troncature peut avoir laisse un tiret en fin : on le retire apres
    // elle, sinon `slice` fabrique un slug qui se termine par `-`.
    .replace(/-+$/g, '');
}

/**
 * Un slug valide, ou une refus.
 *
 * Valide signifie : non vide, borne, et compose uniquement de minuscules, de
 * chiffres et de tirets simples. Un appelant qui fournit son propre slug passe
 * donc par le meme filtre qu'un slug derive — sinon il pourrait glisser un `/`
 * et fabriquer un chemin de plusieurs segments, ou un `.` et faire croire a une
 * extension de fichier.
 *
 * Le refus est `UNPROCESSABLE` et non `BAD_REQUEST` : la requete est bien formee,
 * c'est le CONTENU du champ qui n'est pas exploitable.
 */
export function assertValidSlug(slug: string): void {
  if (slug.length === 0) {
    throw AppException.unprocessable('SLUG_INVALID', 'Le slug ne peut pas etre vide.');
  }

  if (slug.length > SLUG_MAX_LENGTH) {
    throw AppException.unprocessable(
      'SLUG_INVALID',
      `Le slug ne peut pas depasser ${SLUG_MAX_LENGTH} caracteres.`,
    );
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw AppException.unprocessable(
      'SLUG_INVALID',
      'Le slug ne peut contenir que des minuscules, des chiffres et des tirets simples.',
    );
  }

  if (RESERVED_SLUGS.includes(slug)) {
    throw AppException.unprocessable(
      'SLUG_RESERVED',
      `« ${slug} » est reserve par l'application et ne peut pas servir de slug.`,
    );
  }
}

/**
 * Le slug a utiliser : celui fourni, sinon celui derive du nom.
 *
 * Les deux passent par `assertValidSlug`, y compris le slug fourni. Un slug
 * saisi a la main est une entree utilisateur comme une autre : le croire sur
 * parole parce qu'il « a l'air correct » est exactement la maniere dont un
 * chemin traverse arrive en base.
 */
export function resolveSlug(explicit: string | undefined, fallbackLabel: string): string {
  const candidate = explicit !== undefined && explicit.trim().length > 0
    ? slugify(explicit)
    : slugify(fallbackLabel);

  assertValidSlug(candidate);

  return candidate;
}

/**
 * Un conflit de slug, sous la forme exacte attendue par le filtre.
 *
 * `CONFLICT` et non `UNPROCESSABLE` : la ressource demandee ne peut pas etre
 * creee parce qu'une autre occupe deja cette adresse. C'est un 409, et le champ
 * en conflit est nomme dans `details` pour que le frontend le place sur le bon
 * input au lieu d'un message general en haut du formulaire.
 */
export function slugConflict(slug: string): AppException {
  return AppException.conflict(
    'SLUG_TAKEN',
    `Le slug « ${slug} » est deja utilise. Choisissez-en un autre.`,
  );
}
