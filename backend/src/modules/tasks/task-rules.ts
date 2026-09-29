import { SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_OWN, type ScopeName } from '../../common/auth/principal.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TaskStatus } from '../../generated/prisma/enums.js';
import type { ScopeSubject } from '../projects/project-scope.js';

/**
 * REGLES DES TACHES — fonctions PURES.
 *
 * Deux familles y cohabitent, et les deux sont des invariants de securite ou de
 * coherence :
 *
 *  1. le PERIMETRE (`taskScopeWhere`) : quelles taches ce porteur peut voir et
 *     modifier. C'est ici que se joue « un developpeur ne modifie que les taches
 *     qui lui sont assignees », et non dans un `if` apres lecture ;
 *  2. la MACHINE A ETATS et sa regle de sous-taches.
 */

/**
 * Filtre impossible. Meme raison que cote projets : un scope inconnu doit ne
 * rien servir, jamais tout. Voir `project-scope.ts`.
 */
const MATCH_NOTHING = { id: { in: [] as string[] } };

/** Du plus large au plus etroit. Voir `AccessPolicy.widestScope`. */
export const TASK_READ_ORDER: readonly ScopeName[] = [SCOPE_ANY, SCOPE_ASSIGNED, SCOPE_OWN];
export const TASK_WRITE_ORDER: readonly ScopeName[] = [SCOPE_ANY, SCOPE_OWN];

/**
 * Filtre de LECTURE d'une tache.
 *
 * `assigned` = la tache m'est assignee. `own` = « mes » taches au sens large :
 * assignees a moi, OU rapportees par moi.
 *
 * Pourquoi `own` est plus large que `assigned` en LECTURE alors qu'il est plus
 * etroit en ECRITURE : celui qui a cree une tache doit pouvoir la suivre, meme
 * avant qu'elle ne soit assignee — sinon il la perd de vue des qu'il la cree.
 * Mais il ne doit pas pour autant pouvoir la MODIFIER : modifier une tache qu'on
 * a creee mais qui appartient a quelqu'un d'autre serait une prise de controle.
 * Lire et ecrire ne partagent donc pas la meme definition de « la mienne », et
 * c'est volontaire.
 */
export function taskScopeWhere(scope: ScopeName, subject: ScopeSubject): Prisma.TaskWhereInput {
  switch (scope) {
    case SCOPE_ANY:
      return {};

    case SCOPE_ASSIGNED:
      return { assigneeId: subject.userId };

    case SCOPE_OWN:
      return { OR: [{ assigneeId: subject.userId }, { reporterId: subject.userId }] };

    default:
      return MATCH_NOTHING;
  }
}

/**
 * Filtre d'ECRITURE d'une tache — plus etroit que celui de lecture.
 *
 * `own` = la tache est ASSIGNEE au porteur, point. C'est la traduction directe de
 * `task:write:own` (« Modifier les taches qui nous sont assignees »), et c'est ce
 * `where` qui rend la regle inoperante a contourner : il ne s'agit pas de lire la
 * ligne puis de verifier `assigneeId === moi`, ce qui laisserait une fenetre et
 * un oubli possible, mais de ne JAMAIS charger la ligne que l'on n'a pas le
 * droit d'ecrire.
 */
export function taskWriteScopeWhere(
  scope: ScopeName,
  subject: ScopeSubject,
): Prisma.TaskWhereInput {
  switch (scope) {
    case SCOPE_ANY:
      return {};

    case SCOPE_OWN:
      return { assigneeId: subject.userId };

    default:
      return MATCH_NOTHING;
  }
}

/**
 * TRANSITIONS DE STATUT D'UNE TACHE.
 *
 * Les statuts « terminaux » sont `DONE` et `CANCELLED` : une tache terminee ne se
 * modifie plus, sauf `task:write:any`. Voir `isTaskEditable` — un developpeur qui
 * s'est trompe de statut ne peut donc pas se corriger lui-meme, c'est le chef de
 * projet qui le fait. C'est le prix de la tracabilite : un `DONE` qui bouge tout
 * seul ne vaut rien dans un rapport d'avancement.
 *
 * Les retours en arriere autorises (`DONE -> IN_PROGRESS`, `CANCELLED -> TODO`)
 * existent pour que la reouverture passe par le circuit normal et laisse une
 * trace, plutot que par une suppression/creation qui effacerait l'historique.
 */
export const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  [TaskStatus.TODO]: [
    TaskStatus.IN_PROGRESS,
    TaskStatus.BLOCKED,
    TaskStatus.DONE,
    TaskStatus.CANCELLED,
  ],
  [TaskStatus.IN_PROGRESS]: [
    TaskStatus.TODO,
    TaskStatus.BLOCKED,
    TaskStatus.IN_REVIEW,
    TaskStatus.DONE,
    TaskStatus.CANCELLED,
  ],
  // Une tache bloquee repart par TODO (le blocage a ete leve) ou par
  // IN_PROGRESS (on reprend le travail en cours). Elle ne va pas directement en
  // DONE : le travail n'a pas ete fait pendant qu'elle etait bloquee.
  [TaskStatus.BLOCKED]: [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  // Depuis la relecture, on corrige (retour IN_PROGRESS) ou on valide (DONE).
  // Pas de CANCELLED : annuler une tache deja realisee n'a pas de sens, le
  // travail existe — c'est DONE qui le constate.
  [TaskStatus.IN_REVIEW]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE],
  [TaskStatus.DONE]: [TaskStatus.IN_PROGRESS],
  [TaskStatus.CANCELLED]: [TaskStatus.TODO],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to);
}

/** Statuts clos : le travail est fini, abandonne, ou les deux. */
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = [TaskStatus.DONE, TaskStatus.CANCELLED];

export function isClosedTaskStatus(status: TaskStatus): boolean {
  return CLOSED_TASK_STATUSES.includes(status);
}

/**
 * LA REGLE DES SOUS-TACHES, EN DEUX VOLETS.
 *
 * Decision : TERMINER UN PARENT AVEC DES ENFANTS OUVERTS EST REFUSE (422).
 *
 * Pourquoi refuser plutot qu'autoriser :
 *
 *  - `DONE` sur un parent est une AFFIRMATION (« le travail est fini »). Si des
 *    enfants restent ouverts, l'affirmation est fausse, et cette fausseté se
 *    propage : l'avancement du projet se calcule depuis les taches, donc un
 *    parent clos a tort gonfle le pourcentage affiche au client.
 *  - la cascade silencieuse (terminer les enfants avec le parent) est pire : elle
 *    marque comme faites des choses que personne n'a verifiees, et personne ne
 *    peut le remarquer puisque le fil d'activite ne montrerait qu'une seule
 *    transition.
 *  - refuser est rattrapable en dix secondes : on termine ou on annule les
 *    enfants, puis on termine le parent. C'est un cout derisoire contre une
 *    donnee fausse qu'aucun ecran ne signalerait.
 *
 * Le second volet rend l'invariant vrai DANS LES DEUX SENS : on refuse aussi de
 * CREER une sous-tache sous un parent clos. Sans cela, un parent `DONE` pouvait
 * redevenir un parent a enfants ouverts une seconde apres avoir ete clos, et la
 * regle du premier volet ne protegeait plus rien.
 *
 * `CANCELLED` compte comme clos : une sous-tache annulee est une decision prise,
 * pas un travail en attente. C'est ce qui donne une sortie a la regle — un
 * parent dont on abandonne le reste peut etre clos apres avoir annule les
 * enfants.
 */
export function hasOpenSubTasks(childStatuses: readonly TaskStatus[]): boolean {
  return childStatuses.some((status) => !isClosedTaskStatus(status));
}

/** Une sous-tache ne s'accroche qu'a un parent encore ouvert. */
export function canAttachSubTask(parentStatus: TaskStatus): boolean {
  return !isClosedTaskStatus(parentStatus);
}

/**
 * Une tache close n'est plus modifiable par un porteur qui n'a que le scope
 * `own`.
 *
 * Le cas concret : un developpeur termine sa tache, puis veut corriger le titre
 * ou l'estimation. On refuse, et l'ecran doit renvoyer vers le chef de projet.
 * La raison est la meme que pour les transitions : si un `DONE` peut encore
 * changer, un rapport d'avancement ne peut plus etre relu avec confiance.
 */
export function isTaskEditable(status: TaskStatus, hasWideScope: boolean): boolean {
  return hasWideScope || !isClosedTaskStatus(status);
}
