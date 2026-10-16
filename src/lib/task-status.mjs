/**
 * Statuts de tâche : miroir d'affichage des règles du serveur
 * (`backend/src/modules/tasks/task-rules.ts`). Fonctions pures, testées sous
 * `npm run test:unit`.
 *
 * Le serveur reste la référence : ces règles servent à ne PROPOSER que des
 * gestes qu'il acceptera (une case à cocher grisée plutôt qu'une erreur 422),
 * jamais à décider à sa place.
 *
 *  - une tâche DE PROJET suit la machine à états stricte (un DONE se rouvre par
 *    IN_PROGRESS, une tâche bloquée ne passe pas directement à DONE) ;
 *  - une tâche PERSONNELLE change librement de statut : c'est un carnet privé,
 *    et décocher une tâche terminée doit la remettre « à faire ».
 */

export const TASK_STATUS_ORDER = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"];
export const OPEN_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "IN_REVIEW"];
export const CLOSED_STATUSES = ["DONE", "CANCELLED"];

/** Machine à états des tâches de projet — copie exacte de `TASK_STATUS_TRANSITIONS`. */
export const PROJECT_TASK_TRANSITIONS = Object.freeze({
  TODO: ["IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"],
  IN_PROGRESS: ["TODO", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED"],
  BLOCKED: ["TODO", "IN_PROGRESS", "CANCELLED"],
  IN_REVIEW: ["IN_PROGRESS", "DONE"],
  DONE: ["IN_PROGRESS"],
  CANCELLED: ["TODO"],
});

export function isClosedStatus(status) {
  return CLOSED_STATUSES.includes(status);
}

export function isOpenStatus(status) {
  return OPEN_STATUSES.includes(status);
}

/** Statuts atteignables depuis le statut courant, dans l'ordre d'affichage. */
export function nextStatuses(task) {
  if (!task || !TASK_STATUS_ORDER.includes(task.status)) return [];
  if (task.isPersonal) return TASK_STATUS_ORDER.filter((status) => status !== task.status);
  const allowed = PROJECT_TASK_TRANSITIONS[task.status] ?? [];
  return TASK_STATUS_ORDER.filter((status) => allowed.includes(status));
}

export function canMoveTo(task, status) {
  return nextStatuses(task).includes(status);
}

/**
 * Ce que fait la case à cocher d'une tâche.
 *
 * @returns {{ checked: boolean, next: string | null, reason: string | null, label: string }}
 *   `next` vaut `null` quand le geste est impossible ; `reason` dit alors
 *   pourquoi (infobulle de la case grisée).
 */
export function completionToggle(task) {
  const status = task?.status;
  const checked = status === "DONE";
  if (!status) return { checked: false, next: null, reason: "Statut inconnu.", label: "Terminer" };

  if (checked) {
    const next = task.isPersonal ? "TODO" : "IN_PROGRESS";
    return {
      checked,
      next: canMoveTo(task, next) ? next : null,
      reason: null,
      label: task.isPersonal ? "Remettre à faire" : "Rouvrir la tâche",
    };
  }

  if (canMoveTo(task, "DONE")) return { checked, next: "DONE", reason: null, label: "Marquer comme terminée" };

  const reason =
    status === "BLOCKED"
      ? "Tâche bloquée : débloquez-la (À faire ou En cours) avant de la terminer."
      : status === "CANCELLED"
        ? "Tâche annulée : rouvrez-la avant de la terminer."
        : "Cette tâche ne peut pas être terminée depuis son statut actuel.";
  return { checked, next: null, reason, label: "Marquer comme terminée" };
}

/** Jour local `YYYY-MM-DD` d'un instant (fuseau du navigateur). */
export function localDay(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Jour d'échéance `YYYY-MM-DD`, lu en UTC : c'est ainsi que l'échéance est
 * saisie (jour à midi ou minuit UTC) et affichée (`formatDateOnly`). La lire
 * dans le fuseau local décalerait une échéance d'un jour selon l'heure.
 */
export function dueDayOf(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/**
 * Tranche d'échéance d'une tâche OUVERTE, au jour près (et non à l'instant :
 * une tâche due aujourd'hui est « aujourd'hui », pas « en retard » dès midi).
 *
 * @returns {"overdue" | "today" | "week" | "later" | "none"}
 */
export function dueBucket(task, now = Date.now()) {
  const due = dueDayOf(task?.dueDate);
  if (!due) return "none";
  const today = localDay(now);
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= addDays(today, 7)) return "week";
  return "later";
}

export function isOverdue(task, now = Date.now()) {
  return isOpenStatus(task?.status) && dueBucket(task, now) === "overdue";
}

export const DUE_BUCKETS = [
  { id: "overdue", label: "En retard" },
  { id: "today", label: "Aujourd’hui" },
  { id: "week", label: "Cette semaine" },
  { id: "later", label: "Plus tard" },
  { id: "none", label: "Sans échéance" },
];

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

/** Tri d'une liste de travail : échéance, puis priorité, puis titre. */
export function compareTasks(left, right) {
  const dueLeft = dueDayOf(left?.dueDate) ?? "9999-12-31";
  const dueRight = dueDayOf(right?.dueDate) ?? "9999-12-31";
  if (dueLeft !== dueRight) return dueLeft < dueRight ? -1 : 1;
  const rank = (PRIORITY_RANK[left?.priority] ?? 9) - (PRIORITY_RANK[right?.priority] ?? 9);
  if (rank) return rank;
  return String(left?.title ?? "").localeCompare(String(right?.title ?? ""), "fr");
}

/** Regroupe des tâches ouvertes par tranche d'échéance (tranches vides omises). */
export function groupByDue(tasks, now = Date.now()) {
  const groups = new Map(DUE_BUCKETS.map((bucket) => [bucket.id, []]));
  for (const task of tasks ?? []) groups.get(dueBucket(task, now))?.push(task);
  return DUE_BUCKETS.map((bucket) => ({ ...bucket, tasks: groups.get(bucket.id).sort(compareTasks) })).filter(
    (group) => group.tasks.length > 0,
  );
}
