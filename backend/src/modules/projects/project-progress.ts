/**
 * AVANCEMENT D'UN PROJET — fonction PURE, sans Prisma ni Nest.
 *
 * `Project.progressPercent` est un avancement DECLARE (voir le schema) : il sert
 * au tableau de bord et peut etre corrige a la main. Mais quand un projet
 * `COMPLETED` est rouvert, `changeStatus` ecrivait `completedAt: null` tout en
 * LAISSANT `progressPercent: 100` (pose lors de la cloture). Le frontend, lui,
 * envoie seulement `{ status }` : le projet rouvert restait donc affiche a
 * 100 % tant que personne ne pensait a corriger le chiffre a la main.
 *
 * On ne transforme pas le champ en valeur calculee en permanence — ce serait un
 * changement de modele. On recalcule UNIQUEMENT au moment ou la declaration
 * devient fausse (sortie de `COMPLETED`), avec la meme regle que les objectifs
 * personnels : les taches annulees ne comptent ni pour ni contre.
 */

/** Statuts de tache (chaines de l'enum Prisma) — aucune import pour rester pur. */
export function projectProgressFromTaskStatuses(statuses: readonly string[]): number {
  const counted = statuses.filter((status) => status !== 'CANCELLED');
  if (counted.length === 0) return 0;
  const done = counted.filter((status) => status === 'DONE').length;
  return Math.round((done / counted.length) * 100);
}
