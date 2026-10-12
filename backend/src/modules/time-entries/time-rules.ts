import { SCOPE_ANY, SCOPE_OWN, type ScopeName } from '../../common/auth/principal.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { ScopeSubject } from '../projects/project-scope.js';

/**
 * REGLES DU TEMPS SAISI — fonctions PURES.
 *
 * Le temps saisi finit en facturation. Deux consequences, et elles expliquent
 * tout ce fichier : une duree fausse se paie, et une duree future n'existe pas.
 */

/** Meme raison que cote projets : un scope inconnu doit ne rien servir. */
const MATCH_NOTHING = { id: { in: [] as string[] } };

export const TIME_READ_ORDER: readonly ScopeName[] = [SCOPE_ANY, SCOPE_OWN];
export const TIME_WRITE_ORDER: readonly ScopeName[] = [SCOPE_ANY, SCOPE_OWN];

/**
 * Filtre de perimetre d'une saisie de temps.
 *
 * `own` = les saisies du PORTEUR (`userId`), pas les saisies des taches qui lui
 * sont assignees. La nuance compte : un developpeur ne doit pas voir le temps
 * qu'un collegue a passe sur une tache qu'il partage, sinon `time:read:own`
 * n'aurait plus rien de prive et les feuilles de temps deviendraient un outil de
 * surveillance.
 */
export function timeEntryScopeWhere(
  scope: ScopeName,
  subject: ScopeSubject,
): Prisma.TimeEntryWhereInput {
  switch (scope) {
    case SCOPE_ANY:
      return {};

    case SCOPE_OWN:
      return { userId: subject.userId };

    default:
      return MATCH_NOTHING;
  }
}

/** Une journee de 24 heures. Au-dela, ce n'est plus une saisie, c'est une erreur. */
export const MAX_MINUTES_PER_ENTRY = 24 * 60;

/**
 * Controle de la duree. Renvoie `null` si elle convient, une phrase sinon.
 *
 * Meme forme que `passwordPolicyViolation` : un controle de politique qui rend
 * sa raison permet de l'afficher telle quelle au lieu de la reecrire a chaque
 * appelant.
 */
export function minutesViolation(minutes: number): string | null {
  if (!Number.isInteger(minutes)) {
    return 'La duree doit etre un nombre entier de minutes.';
  }
  if (minutes <= 0) {
    return 'La duree doit etre strictement positive.';
  }
  if (minutes > MAX_MINUTES_PER_ENTRY) {
    return `Une saisie ne peut pas depasser ${MAX_MINUTES_PER_ENTRY} minutes (24 heures).`;
  }
  return null;
}

/** Debut du jour UTC, pour comparer des JOURNEES et non des instants. */
function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Ramene un instant a la journee UTC qu'il represente.
 *
 * `spentOn` n'est pas un instant mais une JOURNEE : « deux heures sur ce projet,
 * mardi ». Stocker l'heure de la saisie ferait dependre les regroupements par
 * jour de l'instant ou quelqu'un a clique, et deux saisies du meme mardi
 * tomberaient de part et d'autre de minuit selon le fuseau. On normalise donc a
 * minuit UTC a l'ecriture, une fois pour toutes.
 */
export function normalizeWorkDay(date: Date): Date {
  return new Date(startOfUtcDay(date));
}

/**
 * Vrai si la date de travail est dans le FUTUR.
 *
 * La comparaison porte sur le JOUR, pas sur l'instant. Comparer `spentOn > now`
 * ferait echouer une saisie faite a 9 h du matin pour un travail de l'apres-midi
 * du meme jour — un cas courant et legitime, qu'un message d'erreur
 * incomprehensible transformerait en reclamation. Le travail « d'aujourd'hui »
 * est donc toujours acceptable, et c'est celui de demain qui est refuse.
 *
 * Le decoupage est en UTC et non dans le fuseau du serveur : un serveur deploye
 * a Paris puis migre ailleurs changerait de comportement sans que personne ne
 * touche au code. Une limite a minuit UTC est previsible, et elle est identique
 * partout.
 */
export function isFutureWorkDay(spentOn: Date, now: Date): boolean {
  return startOfUtcDay(spentOn) > startOfUtcDay(now);
}

/**
 * PERIMETRE COMPLET D'UNE SAISIE DE TEMPS : la personne, PUIS le projet.
 *
 * `own` EST DEJA UN PERIMETRE COMPLET. Le filtre vaut `{ userId: <porteur> }` :
 * une seule ligne possible par personne, et aucune autre. Il n'y a donc rien a
 * borner davantage — et surtout PAS par le projet, car une saisie personnelle
 * doit rester visible meme si le projet a ete supprime ou si son porteur en a ete
 * retire. Une feuille de temps qui perd des lignes selon l'etat d'un projet n'est
 * plus une feuille de temps.
 *
 * `any` EST LE SEUL SCOPE QUI A BESOIN DU PROJET. « Toutes les saisies » veut
 * dire, comme partout dans ce catalogue, « toutes celles des projets que je peux
 * atteindre » — jamais « toutes celles de l'agence ». Sans ce second filtre, un
 * role qui recevrait `time:read:any` sans perimetre de projet lirait le temps de
 * toute la structure.
 *
 * LES SAISIES SANS PROJET (taches personnelles) ne tombent dans AUCUN perimetre
 * de projet, et le filtre de relation `project: {...}` les exclurait toutes —
 * y compris celles du porteur lui-meme. Le `any` est donc un OU : le perimetre
 * de projet, PLUS ses propres saisies (`userId`). Un responsable voit ainsi son
 * temps personnel sans jamais voir celui des autres : une saisie sans projet
 * d'un collegue ne satisfait aucune des deux branches.
 *
 * Le troisieme parametre est le filtre de projet deja construit. S'il manque
 * alors que le scope est `any`, on ne sert RIEN : c'est un appelant qui a oublie
 * de le fournir, et une erreur d'appel ne doit pas se transformer en fuite.
 */
export function timeEntryPerimeter(
  scope: ScopeName,
  subject: ScopeSubject,
  projectWhere: Prisma.ProjectWhereInput | null,
): Prisma.TimeEntryWhereInput {
  const personFilter = timeEntryScopeWhere(scope, subject);

  if (scope !== SCOPE_ANY) {
    return personFilter;
  }

  if (!projectWhere) {
    return MATCH_NOTHING;
  }

  return {
    OR: [
      { AND: [personFilter, { project: { deletedAt: null, AND: [projectWhere] } }] },
      { userId: subject.userId },
    ],
  };
}
