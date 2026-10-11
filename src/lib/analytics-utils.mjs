const STATUS_LABEL = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  BLOCKED: "Bloquées",
  IN_REVIEW: "En revue",
  DONE: "Terminées",
  CANCELLED: "Annulées",
};

const isoDay = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

/** Agrégations pures des données réelles de l'analytique d'équipe. */
export function buildAnalytics(entries, projects, tasks, users, from, to) {
  const dayKeys = [];
  for (let date = new Date(`${from}T12:00:00`); isoDay(date) <= to; date.setDate(date.getDate() + 1)) {
    dayKeys.push(isoDay(date));
  }

  const perDay = Object.fromEntries(dayKeys.map((key) => [key, 0]));
  const perUser = {};
  let totalMinutes = 0;
  for (const entry of entries) {
    const minutes = Number(entry.minutes) || 0;
    totalMinutes += minutes;
    const key = String(entry.spentOn ?? "").slice(0, 10);
    if (key in perDay) perDay[key] += minutes;
    perUser[entry.userId] = (perUser[entry.userId] ?? 0) + minutes;
  }

  const names = Object.fromEntries(users.map((user) => [
    user.id,
    `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email,
  ]));
  const byMember = [];
  let unnamedMinutes = 0;
  for (const [id, minutes] of Object.entries(perUser)) {
    if (names[id]) byMember.push({ name: names[id], heures: Math.round((minutes / 60) * 10) / 10 });
    else unnamedMinutes += minutes;
  }
  if (unnamedMinutes > 0) {
    byMember.push({ name: "Membres sans nom accessible", heures: Math.round((unnamedMinutes / 60) * 10) / 10 });
  }
  byMember.sort((a, b) => b.heures - a.heures);
  byMember.splice(8);

  const statusCount = {};
  for (const task of tasks) statusCount[task.status] = (statusCount[task.status] ?? 0) + 1;
  const statusSlices = Object.entries(statusCount)
    .filter(([key]) => key !== "CANCELLED")
    .map(([key, value]) => ({ key, name: STATUS_LABEL[key] ?? key, value }));

  const activeProjects = projects.filter((project) => !["COMPLETED", "CANCELLED", "ARCHIVED"].includes(project.status)).length;
  const avgProgress = projects.length
    ? Math.round(projects.reduce((sum, project) => sum + (project.progressPercent ?? 0), 0) / projects.length)
    : 0;

  // Les KPI « 7 jours » couvrent aujourd'hui et les six jours précédents de la période.
  const weekMinutes = dayKeys.slice(-7).reduce((sum, key) => sum + perDay[key], 0);

  // Les tâches annulées sont exclues ; une tâche terminée ne peut pas être en retard.
  const counted = tasks.filter((task) => task.status !== "CANCELLED");
  const doneCount = counted.filter((task) => task.status === "DONE").length;
  const lateCount = counted.filter((task) => task.status !== "DONE" && task.dueDate && String(task.dueDate).slice(0, 10) < to).length;
  const total = counted.length;
  const openCount = total - doneCount - lateCount;

  return {
    totalHours: totalMinutes / 60,
    weekHours: weekMinutes / 60,
    doneCount,
    lateCount,
    openCount,
    total,
    completionRate: total ? Math.round((doneCount / total) * 100) : 0,
    daily: dayKeys.map((key) => ({
      day: new Date(`${key}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      heures: Math.round((perDay[key] / 60) * 10) / 10,
    })),
    byMember,
    tasksByStatus: statusCount,
    statusSlices,
    activeProjects,
    avgProgress,
    projects: projects.slice(0, 8).map((project) => ({
      id: project.id,
      name: project.name,
      progress: project.progressPercent ?? 0,
    })),
  };
}
