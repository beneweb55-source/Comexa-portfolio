/**
 * Plan de la journée : règles de lecture, pas décision automatique.
 *
 * Ce module ne crée AUCUNE nouvelle donnée. Il dérive, à partir de `/me/tasks`
 * et `/me/calendar/events` :
 *  - les tâches ouvertes échues aujourd'hui ou en retard ;
 *  - une estimation de charge connue (estimations + rendez-vous datés) ;
 *  - les tâches sans estimation, comptées séparément — jamais comme zéro ;
 *  - une prochaine action explicite.
 *
 * Il NE calcule pas de capacité : Comexa ne stocke aujourd'hui ni horaires de
 * travail, ni heure de fin de journée, ni contraintes personnelles. Prétendre
 * qu'une journée est « surchargée » sans ces données serait une invention. Les
 * chevauchements d'événements sont fusionnés pour ne pas compter deux fois le
 * même créneau.
 */

import { addDaysToDay, dueDateForLocalDay } from "./day-utils.mjs";
import { compareTasks, dueBucket, isOpenStatus, localDay } from "./task-status.mjs";

function positiveEstimate(task) {
  const value = Number(task?.estimateMinutes);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function eventDay(event) {
  const value = event?.startsAt;
  if (!value) return null;
  // Un événement « toute la journée » est stocké à minuit UTC : le lire en
  // heure locale décalerait son jour dans les fuseaux à l'ouest de UTC.
  if (event.allDay) return String(value).slice(0, 10);
  return localDay(value);
}

function dayBounds(now) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { from: dayStart.getTime(), to: dayEnd.getTime() };
}

/** Un événement commencé la veille mais terminé aujourd'hui compte aussi. */
export function eventOverlapsDay(event, now = Date.now()) {
  if (!event || event.allDay || !event.startsAt || !event.endsAt) return false;
  const { from, to } = dayBounds(now);
  const starts = Date.parse(event.startsAt);
  const ends = Date.parse(event.endsAt);
  return Number.isFinite(starts) && Number.isFinite(ends) && ends > from && starts < to;
}

/** Minutes réellement occupées par des événements datés, sans double comptage. */
export function timedEventMinutesOn(events, now = Date.now()) {
  const { from: fromLimit, to: toLimit } = dayBounds(now);

  const intervals = (Array.isArray(events) ? events : [])
    .filter((event) => eventOverlapsDay(event, now))
    .map((event) => {
      const from = Math.max(Date.parse(event.startsAt), fromLimit);
      const to = Math.min(Date.parse(event.endsAt), toLimit);
      return Number.isFinite(from) && Number.isFinite(to) && to > from ? { from, to } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.from - right.from);

  let minutes = 0;
  let current = null;
  for (const interval of intervals) {
    if (!current) {
      current = { ...interval };
      continue;
    }
    if (interval.from <= current.to) current.to = Math.max(current.to, interval.to);
    else {
      minutes += Math.ceil((current.to - current.from) / 60_000);
      current = { ...interval };
    }
  }
  if (current) minutes += Math.ceil((current.to - current.from) / 60_000);
  return minutes;
}

function compareDayTasks(left, right, now) {
  const lateLeft = dueBucket(left, now) === "overdue" ? 0 : 1;
  const lateRight = dueBucket(right, now) === "overdue" ? 0 : 1;
  if (lateLeft !== lateRight) return lateLeft - lateRight;
  return compareTasks(left, right);
}

/**
 * Capacité d'affichage d'un report explicite. L'API garde l'autorité ; ce test
 * évite seulement de montrer une action qu'elle refuserait ou qui contredirait
 * le gel d'un objectif atteint.
 */
export function canPostponeTask(task, { canWritePersonal = false, canWriteProject = false } = {}) {
  if (!task?.id || !isOpenStatus(task.status)) return false;
  if (task.goal?.status === "ACHIEVED") return false;
  return task.isPersonal ? Boolean(canWritePersonal) : Boolean(canWriteProject);
}

export function tomorrowIsoDay(now = Date.now()) {
  return addDaysToDay(localDay(now) ?? new Date(now).toISOString().slice(0, 10), 1);
}

/** Corps minimal de `PATCH /tasks/:id` pour un report décidé par l'utilisateur. */
export function postponePayload(now = Date.now()) {
  return { dueDate: dueDateForLocalDay(tomorrowIsoDay(now)) };
}

export function buildDayPlan({ tasks = [], events = [], now = Date.now() } = {}) {
  const today = localDay(now) ?? new Date(now).toISOString().slice(0, 10);
  const taskRows = Array.isArray(tasks) ? tasks : [];
  const eventRows = Array.isArray(events) ? events : [];
  const open = taskRows.filter((task) => isOpenStatus(task.status));
  const dueTasks = open
    .filter((task) => ["overdue", "today"].includes(dueBucket(task, now)))
    .sort((left, right) => compareDayTasks(left, right, now));

  const estimated = dueTasks.map(positiveEstimate).filter((minutes) => minutes !== null);
  const estimatedMinutes = estimated.reduce((sum, minutes) => sum + minutes, 0);
  const unestimatedCount = dueTasks.length - estimated.length;
  const overdueCount = dueTasks.filter((task) => dueBucket(task, now) === "overdue").length;
  const doneToday = taskRows.filter(
    (task) => task.status === "DONE" && localDay(task.completedAt) === today,
  ).length;

  // Un événement daté est retenu s'il chevauche le jour local, même commencé
  // la veille ; un événement « toute la journée » est lié à son jour UTC de
  // stockage. Les deux notions ne doivent pas être confondues.
  const timedEvents = eventRows.filter((event) => eventOverlapsDay(event, now));
  const eventMinutes = timedEventMinutesOn(eventRows, now);
  const allDayEventCount = eventRows.filter(
    (event) => event?.allDay && eventDay(event) === today,
  ).length;

  return {
    today,
    dueTasks,
    nextTask: dueTasks[0] ?? null,
    decisionTasks: dueTasks.slice(0, 3),
    overdueCount,
    doneToday,
    estimatedMinutes,
    unestimatedCount,
    timedEventCount: timedEvents.length,
    allDayEventCount,
    eventMinutes,
    knownLoadMinutes: estimatedMinutes + eventMinutes,
    hasLoadData: estimated.length > 0 || eventMinutes > 0,
  };
}
