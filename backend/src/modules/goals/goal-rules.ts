import { GoalStatus, TaskStatus } from '../../generated/prisma/enums.js';

/**
 * REGLES DES OBJECTIFS PERSONNELS — fonctions PURES, testees a l'unite.
 *
 * Un objectif est un but que le membre se fixe et le groupe de taches qui y
 * mene. Son avancement se DEDUIT des taches (jamais saisi a la main) : un
 * pourcentage tape au clavier finit toujours par mentir.
 */

/** Teintes pastel de la charte (voir `softui.tokens.css`). */
export const GOAL_COLORS = ['blue', 'green', 'yellow', 'lilac', 'pink'] as const;
export type GoalColor = (typeof GOAL_COLORS)[number];

export function isGoalColor(value: unknown): value is GoalColor {
  return typeof value === 'string' && (GOAL_COLORS as readonly string[]).includes(value);
}

export interface GoalProgress {
  /** Taches rattachees et visibles du proprietaire. */
  readonly total: number;
  readonly done: number;
  readonly open: number;
  readonly cancelled: number;
  /** `done / (total - cancelled)`, arrondi ; 0 sans tache comptable. */
  readonly percent: number;
}

/**
 * Avancement d'un objectif.
 *
 * UNE TACHE ANNULEE NE COMPTE NI POUR NI CONTRE : c'est une decision prise
 * (« on ne le fera pas »), pas du travail restant. La compter au denominateur
 * bloquerait l'objectif sous 100 % pour toujours ; la compter comme faite
 * gonflerait l'avancement.
 */
export function goalProgressOf(statuses: readonly TaskStatus[]): GoalProgress {
  const total = statuses.length;
  const done = statuses.filter((status) => status === TaskStatus.DONE).length;
  const cancelled = statuses.filter((status) => status === TaskStatus.CANCELLED).length;
  const open = total - done - cancelled;
  const counted = total - cancelled;
  const percent = counted === 0 ? 0 : Math.round((done / counted) * 100);
  return { total, done, open, cancelled, percent };
}

/**
 * Date d'atteinte apres un changement de statut.
 *
 *  - ATTEINT : maintenant (sauf s'il l'etait deja : la date d'origine reste) ;
 *  - ACTIF : effacee — un objectif rouvert n'est plus atteint ;
 *  - ARCHIVE : inchangee — archiver un objectif atteint ne reecrit pas
 *    l'histoire, archiver un objectif abandonne n'invente pas de reussite.
 */
export function achievedAtAfter(
  previous: { readonly status: GoalStatus; readonly achievedAt: Date | null },
  next: GoalStatus,
  now: Date,
): Date | null {
  switch (next) {
    case GoalStatus.ACHIEVED:
      return previous.status === GoalStatus.ACHIEVED && previous.achievedAt
        ? previous.achievedAt
        : now;
    case GoalStatus.ACTIVE:
      return null;
    case GoalStatus.ARCHIVED:
      return previous.achievedAt;
    default:
      return previous.achievedAt;
  }
}

/**
 * Peut-on DECLARER un objectif `ACHIEVED` avec cet avancement ?
 *
 * INVARIANT G1 — un objectif atteint est un CONSTAT, pas un voeu : il lui faut
 * au moins une tache reellement terminee, et aucune tache encore ouverte. Une
 * tache annulee ne compte ni pour ni contre (voir `goalProgressOf`), donc un
 * objectif dont TOUTES les taches sont annulees n'est pas atteint : rien n'a ete
 * fait. Sans cette regle, `PATCH /me/goals/:id {status: ACHIEVED}` creait un
 * objectif « atteint » a 0 %, et le frontend masquait le mensonge en forcant
 * l'anneau a 100 %.
 *
 * Les trois motifs sont distincts pour que l'API dise QUOI faire : ajouter une
 * tache, en terminer une, ou finir celles qui restent.
 */
export type GoalAchievementBlocker = 'GOAL_NO_TASKS' | 'GOAL_NO_DONE_TASK' | 'GOAL_HAS_OPEN_TASKS';

export function goalAchievementBlocker(progress: GoalProgress): GoalAchievementBlocker | null {
  const countable = progress.total - progress.cancelled;
  // Distinguer « aucune tache » de « tout annule » : le remede n'est pas le
  // meme (ajouter une tache vs en terminer reellement une).
  if (progress.total <= 0) return 'GOAL_NO_TASKS';
  if (countable <= 0) return 'GOAL_NO_DONE_TASK';
  if (progress.done <= 0) return 'GOAL_NO_DONE_TASK';
  if (progress.open > 0 || progress.done !== countable) return 'GOAL_HAS_OPEN_TASKS';
  return null;
}

export function goalCanBeAchieved(progress: GoalProgress): boolean {
  return goalAchievementBlocker(progress) === null;
}

export function goalAchievementMessage(
  blocker: GoalAchievementBlocker,
  progress: GoalProgress,
): string {
  switch (blocker) {
    case 'GOAL_NO_TASKS':
      return 'Ajoutez au moins une tâche non annulée à cet objectif avant de le déclarer atteint.';
    case 'GOAL_NO_DONE_TASK':
      return 'Toutes les tâches de cet objectif sont annulées : terminez-en au moins une avant de le déclarer atteint.';
    case 'GOAL_HAS_OPEN_TASKS':
      return `Terminez ou annulez les ${progress.open} tâche(s) encore ouverte(s) avant de déclarer cet objectif atteint.`;
  }
}

/**
 * Seul un objectif `ACTIVE` accepte de NOUVELLES taches.
 *
 * Avant correction cette fonction n'ecartait que `ARCHIVED`, alors que son
 * commentaire d'appel (`TasksService.requireOwnOpenGoal`) promettait « ni atteint
 * ni archive ». Un objectif atteint pouvait donc recevoir une tache ouverte et
 * rester affiche « Atteint » — l'invariant G1 etait faux une seconde apres avoir
 * ete pose. La declaration se rejoue en `ACTIVE` (bouton « Rouvrir »), jamais
 * en contournant la regle.
 */
export function goalAcceptsTasks(status: GoalStatus): boolean {
  return status === GoalStatus.ACTIVE;
}

/**
 * Un objectif atteint GELE ses taches : aucune d'elles ne peut quitter `DONE`,
 * etre detachee, supprimee ou reassignede, sinon l'avancement repasse sous 100 %
 * alors que le statut, lui, reste `ACHIEVED`.
 *
 * On refuse ces gestes avec un message explicite (« rouvrez l'objectif ») plutot
 * que de rouvrir l'objectif en douce : `achievedAt` est une date d'histoire, et
 * une cascade silencieuse effacerait la trace de la reussite declaree. Voir
 * `task-rules.ts` pour la meme philosophie sur les parents `DONE`.
 */
export function goalFreezesTasks(status: GoalStatus): boolean {
  return status === GoalStatus.ACHIEVED;
}

/** Statut encore compatible avec un objectif atteint : rester/ redevenir DONE. */
export function goalAcceptsTaskStatus(status: GoalStatus, next: TaskStatus): boolean {
  return !goalFreezesTasks(status) || next === TaskStatus.DONE;
}
