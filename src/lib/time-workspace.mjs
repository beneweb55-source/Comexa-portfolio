import { localDateInputValue } from "./timer-utils.mjs";

export const DEFAULT_TIME_PREFERENCES = Object.freeze({
  minutes: 60,
  billable: true,
  period: "week",
});
export function normalizeTimePreferences(value) {
  return {
    minutes:
      Number.isInteger(value?.minutes) &&
      value.minutes >= 1 &&
      value.minutes <= 1440
        ? value.minutes
        : 60,
    billable: typeof value?.billable === "boolean" ? value.billable : true,
    period: ["today", "week", "month", "all"].includes(value?.period)
      ? value.period
      : "week",
  };
}
export function timeRange(period, now = new Date()) {
  const start = new Date(now);
  const to = localDateInputValue(now);
  if (period === "all") return { from: "", to: "" };
  if (period === "week")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === "month") start.setDate(1);
  return { from: localDateInputValue(start), to };
}
export function summarizeTime(items) {
  return items.reduce(
    (result, entry) => {
      const minutes = Number(entry.minutes) || 0;
      result.total += minutes;
      if (entry.billable) result.billable += minutes;
      return result;
    },
    { total: 0, billable: 0 },
  );
}
export function timeCsv(items) {
  // Excel ne doit jamais interpréter une description comme une formule.
  const cell = (value) =>
    `"${String(value ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  const rows = [
    [
      "Date",
      "Tâche",
      "Projet",
      "Membre",
      "Minutes",
      "Facturable",
      "Description",
    ],
    ...items.map((e) => [
      e.spentOn?.slice(0, 10),
      e.task?.title,
      e.project?.name,
      [e.user?.firstName, e.user?.lastName].filter(Boolean).join(" "),
      e.minutes,
      e.billable ? "Oui" : "Non",
      e.description,
    ]),
  ];
  return "\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n");
}
