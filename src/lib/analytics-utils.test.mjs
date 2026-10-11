import assert from "node:assert/strict";
import test from "node:test";
import { buildAnalytics } from "./analytics-utils.mjs";

const RANGE = { from: "2026-10-01", to: "2026-10-30" };

test("buildAnalytics aggregates real hours, keeps the seven-day window, and anonymizes hidden members", () => {
  const data = buildAnalytics(
    [
      { userId: "u1", minutes: 60, spentOn: "2026-10-30" },
      { userId: "u2", minutes: 30, spentOn: "2026-10-29" },
      { userId: "u3", minutes: 90, spentOn: "2026-10-25" },
    ],
    [],
    [],
    [{ id: "u1", firstName: "Aïcha", lastName: "B." }],
    RANGE.from,
    RANGE.to,
  );

  assert.equal(data.totalHours, 3);
  assert.equal(data.weekHours, 3);
  assert.equal(data.daily.length, 30);
  assert.equal(data.daily[24].heures, 1.5);
  assert.deepEqual(data.byMember, [
    { name: "Membres sans nom accessible", heures: 2 },
    { name: "Aïcha B.", heures: 1 },
  ]);
});

test("buildAnalytics excludes cancelled tasks and counts late, active projects, and progress", () => {
  const data = buildAnalytics(
    [],
    [
      { id: "p1", name: "Actif", status: "IN_PROGRESS", progressPercent: 40 },
      { id: "p2", name: "Terminé", status: "COMPLETED", progressPercent: 100 },
      { id: "p3", name: "Archivé", status: "ARCHIVED", progressPercent: 80 },
    ],
    [
      { id: "t1", status: "DONE", dueDate: "2026-10-10" },
      { id: "t2", status: "TODO", dueDate: "2026-10-29" },
      { id: "t3", status: "IN_PROGRESS", dueDate: "2026-10-31" },
      { id: "t4", status: "CANCELLED", dueDate: "2026-10-01" },
      { id: "t5", status: "TODO", dueDate: "2026-10-30T12:00:00.000Z" },
    ],
    [],
    RANGE.from,
    RANGE.to,
    Date.parse("2026-10-30T12:00:00.000Z"),
  );

  assert.equal(data.total, 4);
  assert.equal(data.doneCount, 1);
  assert.equal(data.lateCount, 1);
  assert.equal(data.openCount, 2);
  assert.equal(data.completionRate, 25);
  assert.equal(data.tasksByStatus.CANCELLED, 1);
  assert.ok(data.statusSlices.every((slice) => slice.key !== "CANCELLED"));
  assert.equal(data.activeProjects, 1);
  assert.equal(data.avgProgress, 73);
});
