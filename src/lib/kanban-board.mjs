/**
 * Tableau Kanban de l'Espace equipe : projection d'affichage et options de
 * statut. AUCUNE nouvelle regle metier : les transitions viennent de
 * `task-status.mjs`, miroir de `backend/src/modules/tasks/task-rules.ts`, et
 * restent re-verifiees par `PATCH /tasks/:id/status`.
 *
 * Le but de ce module est que l'ecran ne recopie plus une troisieme fois la
 * machine a etats : une carte propose exactement les statuts que le serveur
 * acceptera, tout en gardant le statut REEL (`BLOCKED`, `CANCELLED`, ...) au
 * lieu de le fondre silencieusement dans une colonne.
 */

import { nextStatuses } from "./task-status.mjs";

export const KANBAN_COLUMNS = Object.freeze([
  Object.freeze({ id: "TODO", label: "À faire" }),
  Object.freeze({ id: "IN_PROGRESS", label: "En cours" }),
  Object.freeze({ id: "IN_REVIEW", label: "En revue" }),
  Object.freeze({ id: "DONE", label: "Terminé" }),
]);

/** Libelles d'affichage uniquement ; la verite des transitions reste ci-dessus. */
export const KANBAN_STATUS_LABEL = Object.freeze({
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  BLOCKED: "Bloquée",
  IN_REVIEW: "En revue",
  DONE: "Terminée",
  CANCELLED: "Annulée",
});

export function kanbanStatusLabel(status) {
  return KANBAN_STATUS_LABEL[status] ?? status ?? "Statut inconnu";
}

/**
 * `BLOCKED` est montree dans la colonne « En cours » avec un badge « Bloquee » :
 * c'est un choix de densite deja en place, pas un statut a part entiere de la
 * colonne. `CANCELLED` et tout statut inconnu n'ont PAS de colonne : ils ne
 * doivent pas disparaitre pour autant.
 */
export function kanbanColumnOf(status) {
  if (status === "BLOCKED") return "IN_PROGRESS";
  return KANBAN_COLUMNS.some((column) => column.id === status) ? status : null;
}

export function splitKanbanTasks(tasks) {
  const columns = Object.fromEntries(KANBAN_COLUMNS.map((column) => [column.id, []]));
  const others = [];
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const column = kanbanColumnOf(task?.status);
    if (column) columns[column].push(task);
    else others.push(task);
  }
  return { columns, others };
}

/**
 * Options d'un select de statut. Le statut courant est toujours montre, meme
 * quand aucune transition n'est possible. En lecture seule, il n'y a donc qu'une
 * option : l'ecran n'offre aucune action que le serveur refuserait.
 */
export function kanbanStatusOptions(task, writable = true) {
  if (!task?.status) return [];
  const current = {
    value: task.status,
    label: kanbanStatusLabel(task.status),
    current: true,
  };
  const transitions = writable
    ? nextStatuses({ status: task.status, isPersonal: false }).map((status) => ({
        value: status,
        label: kanbanStatusLabel(status),
        current: false,
      }))
    : [];
  return [current, ...transitions];
}
