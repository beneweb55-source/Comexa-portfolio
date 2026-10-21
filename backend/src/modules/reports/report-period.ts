import { AppException } from '../../common/errors/app-error.js';

/**
 * BORNES DE PERIODE D'UN RAPPORT.
 *
 * Ce fichier ne fait QUE du calcul de dates, sans base ni Nest : c'est ce qui
 * permet de l'exercer exhaustivement. Une borne
 * fausse ne se voit pas a l'ecran — elle se voit six mois plus tard, quand
 * quelqu'un compare le rapport a sa comptabilite.
 *
 * DEUX DECISIONS EXPLICITES.
 *
 * 1. LES BORNES SONT INCLUSIVES : `[start, end]`, soit `gte start` et
 *    `lte end` dans les requetes. Le mode semi-ouvert `[start, end)` est plus
 *    elegant pour enchainer des periodes, mais le modele `Report` stocke un
 *    `periodEnd` que relira un humain. Une borne haute exclusive rangee dans un
 *    champ nomme `periodEnd` produit exactement le decalage d'un jour que
 *    personne ne voit avant de le payer. Les presets normalisent donc la borne
 *    haute a `23:59:59.999` du dernier jour.
 *
 * 2. LE FUSEAU EST CELUI DU SERVEUR, pas UTC. Une agence francaise dont la
 *    journee est decoupee en UTC perd les factures emises entre 00h00 et 02h00
 *    (heure d'ete) : elles tombent la veille. `Date` local est ce qui correspond
 *    a la journee vecue par l'agence, et c'est ce que le dirigeant compare a son
 *    releve bancaire.
 */

/** Presets proposes a l'interface. Le nom est stable, le libelle non. */
export const PERIOD_PRESETS = [
  'TODAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
  'LAST_YEAR',
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** Bornes inclusives. `end` est le DERNIER instant de la periode. */
export interface PeriodBounds {
  readonly start: Date;
  readonly end: Date;
}

export interface PeriodInput {
  readonly preset?: PeriodPreset | undefined;
  readonly periodStart?: Date | undefined;
  readonly periodEnd?: Date | undefined;
}

/** Preset applique quand la demande n'en fournit aucun. */
export const DEFAULT_PRESET: PeriodPreset = 'THIS_MONTH';

/**
 * Ecart maximal entre les deux bornes.
 *
 * Cinq ans. Ce n'est pas une regle metier : c'est une borne de defense. Un
 * rapport « depuis 1970 » declencherait des agregations sur toute la table, sur
 * une route qui n'est limitee en debit que globalement.
 */
export const MAX_PERIOD_DAYS = 366 * 5;

const MS_PER_DAY = 86_400_000;

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === 'string' && (PERIOD_PRESETS as readonly string[]).includes(value);
}

function invalidPeriod(message: string, details?: unknown): AppException {
  return AppException.unprocessable('REPORT_PERIOD_INVALID', message, details ?? null);
}

function instant(value: unknown, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw invalidPeriod(`${label} n'est pas une date exploitable.`);
  }
  return value;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date.getTime());
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function addDays(date: Date, days: number): Date {
  // On passe par le calendrier (`setDate`) et non par `+ days * 86400000` : le
  // calcul en millisecondes deraille au changement d'heure, ou une journee dure
  // 23 ou 25 heures.
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  // Le 1 est utilise comme point d'ancrage par tous les appelants, donc le
  // report du 31 janvier au 3 mars ne peut pas se produire ici.
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  // Le jour 0 du mois suivant est le dernier jour du mois courant : c'est la
  // seule facon d'obtenir le 28/29 fevrier sans table de durees de mois.
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function quarterStartMonth(month: number): number {
  return Math.floor(month / 3) * 3;
}

function boundsOfPreset(preset: PeriodPreset, now: Date): PeriodBounds {
  switch (preset) {
    case 'TODAY':
      return { start: startOfDay(now), end: endOfDay(now) };

    case 'LAST_7_DAYS':
      // Sept jours, aujourd'hui COMPRIS : c'est ce qu'attend un utilisateur qui
      // clique « 7 derniers jours » un lundi et veut voir le lundi precedent.
      return { start: startOfDay(addDays(now, -6)), end: endOfDay(now) };

    case 'LAST_30_DAYS':
      return { start: startOfDay(addDays(now, -29)), end: endOfDay(now) };

    case 'THIS_MONTH':
      return { start: startOfMonth(now), end: endOfMonth(now) };

    case 'LAST_MONTH': {
      const previous = addMonths(now, -1);
      return { start: startOfMonth(previous), end: endOfMonth(previous) };
    }

    case 'THIS_QUARTER': {
      const firstMonth = quarterStartMonth(now.getMonth());
      const start = new Date(now.getFullYear(), firstMonth, 1, 0, 0, 0, 0);
      // Le dernier jour du trimestre = le jour 0 du mois qui suit les trois
      // mois du trimestre.
      const end = new Date(now.getFullYear(), firstMonth + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }

    case 'THIS_YEAR':
      return {
        start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
        end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999),
      };

    case 'LAST_YEAR':
      return {
        start: new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0),
        end: new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999),
      };

    default: {
      // Exhaustivite : ajouter un preset sans lui donner de bornes ne compile
      // pas. C'est volontaire, un preset sans bornes vaudrait « toute la base ».
      const unreachable: never = preset;
      throw invalidPeriod(`Preset de periode inconnu : ${String(unreachable)}`);
    }
  }
}

/**
 * Bornes effectives d'une demande.
 *
 * Trois formes acceptees, et une seule a la fois :
 *   - un preset (`THIS_MONTH`) ;
 *   - un couple de bornes explicites ;
 *   - rien du tout, auquel cas `DEFAULT_PRESET` s'applique.
 *
 * Melanger un preset et des bornes explicites est REFUSE plutot qu'arbitre :
 * ignorer silencieusement l'un des deux produirait un rapport dont la periode
 * n'est pas celle demandee, et personne ne s'en apercevrait avant de comparer
 * les chiffres.
 *
 * `now` est injectable pour que les tests soient deterministes : sans cela, un
 * test ecrit le 31 janvier passerait et echouerait le 1er fevrier.
 */
export function resolvePeriod(input: PeriodInput, now: Date = new Date()): PeriodBounds {
  const hasExplicitStart = input.periodStart !== undefined;
  const hasExplicitEnd = input.periodEnd !== undefined;

  if (input.preset !== undefined && (hasExplicitStart || hasExplicitEnd)) {
    throw AppException.unprocessable(
      'REPORT_PERIOD_AMBIGUOUS',
      'Indiquez soit un preset de periode, soit une date de debut et de fin — pas les deux.',
    );
  }

  if (hasExplicitStart !== hasExplicitEnd) {
    throw AppException.unprocessable(
      'REPORT_PERIOD_INCOMPLETE',
      'Une periode explicite exige une date de debut ET une date de fin.',
    );
  }

  if (hasExplicitStart && hasExplicitEnd) {
    const start = instant(input.periodStart, 'La date de debut');
    const end = instant(input.periodEnd, 'La date de fin');

    if (end.getTime() < start.getTime()) {
      throw invalidPeriod('La date de fin ne peut pas preceder la date de debut.', {
        periodStart: start.toISOString(),
        periodEnd: end.toISOString(),
      });
    }

    const spanDays = (end.getTime() - start.getTime()) / MS_PER_DAY;
    if (spanDays > MAX_PERIOD_DAYS) {
      throw invalidPeriod(
        `La periode demandee est trop large (maximum ${MAX_PERIOD_DAYS} jours).`,
        { days: Math.ceil(spanDays) },
      );
    }

    return { start, end };
  }

  return boundsOfPreset(input.preset ?? DEFAULT_PRESET, now);
}

/** Filtre Prisma correspondant a des bornes inclusives. */
export function withinPeriod(bounds: PeriodBounds): { gte: Date; lte: Date } {
  return { gte: bounds.start, lte: bounds.end };
}

/**
 * Memes bornes, relatives au fuseau.
 *
 * `toISOString` convertit en UTC : les deux valeurs ci-dessus ne sont donc pas
 * telles quelles les bornes locales. On les expose quand meme, parce qu'un
 * instantane de rapport doit porter la date exacte sur laquelle il a ete
 * calcule, et que deux machines dans deux fuseaux doivent lire la meme chose.
 */
export interface SerializedPeriod {
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Bornes locales, telles qu'elles ont servi au calcul. */
  readonly startLocal: string;
  readonly endLocal: string;
}

function localIso(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');

  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');

  return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${hh}:${mm}`;
}

export function serializePeriod(bounds: PeriodBounds): SerializedPeriod {
  return {
    periodStart: bounds.start.toISOString(),
    periodEnd: bounds.end.toISOString(),
    startLocal: localIso(bounds.start),
    endLocal: localIso(bounds.end),
  };
}
