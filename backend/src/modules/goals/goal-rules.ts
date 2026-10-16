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

/** Un objectif archive est range : on n'y ajoute plus de tache. */
export function goalAcceptsTasks(status: GoalStatus): boolean {
  return status !== GoalStatus.ARCHIVED;
}
