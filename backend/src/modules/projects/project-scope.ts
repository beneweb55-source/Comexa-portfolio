import {
  SCOPE_ANY,
  SCOPE_ASSIGNED,
  SCOPE_OWN,
  type ScopeName,
} from '../../common/auth/principal.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ProjectStatus } from '../../generated/prisma/enums.js';

/**
 * PERIMETRE DES PROJETS — fonctions PURES, donc testables sans base.
 *
 * Ce fichier est la FRONTIERE DE SECURITE du domaine. Tout ce qui decide
 * « quelles lignes ce porteur a le droit de voir » est ici, et nulle part
 * ailleurs ; les services ne font que composer ces `where` et les passer a
 * Prisma.
 *
 * La raison de cette separation n'est pas l'elegance. Un filtre de perimetre
 * enfoui au milieu d'une methode de service ne se teste qu'avec une base et un
 * porteur complet — c'est-a-dire qu'en pratique il ne se teste pas. Ecrit ici, il
 * se verifie en trois lignes, et une regression sur `own` se voit tout de suite.
 */

/** Ce que les filtres ont besoin de savoir du porteur. Volontairement minimal. */
export interface ScopeSubject {
  readonly userId: string;
  readonly clientId: string | null;
  /** Vrai pour un compte de l'espace client (role CLIENT). */
  readonly isClient: boolean;
}

/**
 * Extraction depuis `AccessPolicy`.
 *
 * Le parametre est STRUCTUREL, pas type `AccessPolicy` : ce fichier n'a pas
 * besoin de la classe, et s'y accrocher obligerait chaque test a construire un
 * porteur complet avec son jeu de permissions.
 */
export function subjectOf(policy: {
  readonly userId: string;
  readonly clientId: string | null;
  isClient(): boolean;
}): ScopeSubject {
  return { userId: policy.userId, clientId: policy.clientId, isClient: policy.isClient() };
}

/**
 * Filtre impossible : aucun identifiant ne vaut la chaine vide.
 *
 * C'est la REPONSE PAR DEFAUT du `switch` ci-dessous, et le choix compte. Si un
 * scope inconnu arrivait jusqu'ici, renvoyer `{}` servirait TOUTES les lignes de
 * la table ; ne rien servir produit une liste vide, c'est-a-dire une panne
 * visible qu'un utilisateur signalera. Un filtre de perimetre doit echouer
 * FERME : le pire des cas doit etre « je ne vois rien », jamais « je vois tout ».
 */
const MATCH_NOTHING = { id: { in: [] as string[] } };

/**
 * Ordres de scopes, du plus LARGE au plus ETROIT.
 *
 * Fournis par l'appelant, comme l'exige `AccessPolicy.widestScope` : il n'y a
 * pas de table de precedence globale, parce qu'elle serait fausse quelque part.
 * Pour un projet, `assigned` (membre de l'equipe) est plus large que `own`
 * (responsable) ; pour une tache, c'est l'inverse qui serait tentant a ecrire.
 * Chaque domaine enonce donc le sien, ici, une fois.
 */
export const PROJECT_READ_ORDER: readonly ScopeName[] = [SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_OWN];
export const PROJECT_WRITE_ORDER: readonly ScopeName[] = [SCOPE_ANY, SCOPE_OWN];

/**
 * Filtre de lecture d'un projet, selon le scope detenu.
 *
 * `own` A DEUX SENS, et c'est le point le plus facile a casser de tout ce
 * fichier :
 *
 *  - pour un compte de l'espace CLIENT, « son » projet est celui de SON dossier
 *    client. Le rattachement vient de `subject.clientId`, resolu en base a
 *    chaque requete — JAMAIS d'un identifiant present dans la requete HTTP.
 *    C'est ce qui empeche un client de lire le projet d'un autre en changeant un
 *    parametre d'URL.
 *  - pour un membre de l'agence, « son » projet est celui dont il est
 *    responsable (`managerId`).
 *
 * Le cas `clientId` absent est traite explicitement : ecrire `clientId: null`
 * en Prisma signifie « IS NULL », ce qui servirait precisement les projets
 * orphelins. Un compte client mal rattache doit ne rien voir, pas tout voir.
 */
export function projectScopeWhere(
  scope: ScopeName,
  subject: ScopeSubject,
): Prisma.ProjectWhereInput {
  switch (scope) {
    case SCOPE_ANY:
      return {};

    case SCOPE_ASSIGNED:
      // `leftAt: null` : un membre retire de l'equipe perd l'acces le jour meme.
      // Sans ce filtre, la ligne d'historique resterait et ouvrirait le projet
      // indefiniment.
      return { members: { some: { userId: subject.userId, leftAt: null } } };

    case SCOPE_OWN:
      if (subject.isClient) {
        return subject.clientId ? { clientId: subject.clientId } : MATCH_NOTHING;
      }
      return { managerId: subject.userId };

    default:
      return MATCH_NOTHING;
  }
}

/**
 * TRANSITIONS DE STATUT D'UN PROJET.
 *
 * Un projet ne se deplace pas librement d'un statut a l'autre : `DRAFT` ->
 * `COMPLETED` en une requete ferait disparaitre tout le travail de suivi, et
 * `ARCHIVED` est une fin de vie qu'on ne defait pas par accident.
 *
 * `COMPLETED -> IN_PROGRESS` est autorise, et c'est deliberé : un projet
 * « termine » qui se revele incomplet doit pouvoir rouvrir. L'inverse — un
 * statut terminal definitif — pousserait a contourner le systeme en creant un
 * second projet pour le meme travail.
 */
export const PROJECT_STATUS_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> =
  {
    [ProjectStatus.DRAFT]: [
      ProjectStatus.PLANNED,
      ProjectStatus.IN_PROGRESS,
      ProjectStatus.CANCELLED,
      ProjectStatus.ARCHIVED,
    ],
    [ProjectStatus.PLANNED]: [
      ProjectStatus.IN_PROGRESS,
      ProjectStatus.ON_HOLD,
      ProjectStatus.CANCELLED,
      ProjectStatus.ARCHIVED,
    ],
    [ProjectStatus.IN_PROGRESS]: [
      ProjectStatus.ON_HOLD,
      ProjectStatus.IN_REVIEW,
      ProjectStatus.COMPLETED,
      ProjectStatus.CANCELLED,
    ],
    [ProjectStatus.ON_HOLD]: [
      ProjectStatus.IN_PROGRESS,
      ProjectStatus.CANCELLED,
      ProjectStatus.ARCHIVED,
    ],
    [ProjectStatus.IN_REVIEW]: [
      ProjectStatus.IN_PROGRESS,
      ProjectStatus.COMPLETED,
      ProjectStatus.ON_HOLD,
      ProjectStatus.CANCELLED,
    ],
    [ProjectStatus.COMPLETED]: [ProjectStatus.IN_PROGRESS],
    [ProjectStatus.CANCELLED]: [ProjectStatus.PLANNED, ProjectStatus.ARCHIVED],
    // `ARCHIVED` est terminal : un projet archive n'est plus dans le flux de
    // travail, il est dans les archives. Le rouvrir demanderait une operation
    // d'administration explicite, qui n'existe pas encore.
    [ProjectStatus.ARCHIVED]: [],
  };

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_STATUS_TRANSITIONS[from].includes(to);
}
