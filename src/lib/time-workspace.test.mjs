import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeTimePreferences,
  timeRange,
  summarizeTime,
  timeCsv,
} from "./time-workspace.mjs";

test("preferences reject malformed storage and preserve false", () => {
  assert.deepEqual(normalizeTimePreferences(null), {
    minutes: 60,
    billable: true,
    period: "week",
  });
  assert.deepEqual(
    normalizeTimePreferences({
      minutes: -3,
      billable: "false",
      period: "invalid",
    }),
    normalizeTimePreferences(null),
  );
  assert.deepEqual(
    normalizeTimePreferences({ minutes: 15, billable: false, period: "month" }),
    { minutes: 15, billable: false, period: "month" },
  );
  assert.equal(normalizeTimePreferences({ minutes: 1441 }).minutes, 60);
});
test("periods follow local calendar, weeks start Monday even on Sunday", () => {
  const sunday = new Date(2026, 9, 18, 12);
  assert.deepEqual(timeRange("week", sunday), {
    from: "2026-10-12",
    to: "2026-10-18",
  });
  assert.deepEqual(timeRange("today", sunday), {
    from: "2026-10-18",
    to: "2026-10-18",
  });
  assert.deepEqual(timeRange("month", sunday), {
    from: "2026-10-01",
    to: "2026-10-18",
  });
  assert.deepEqual(timeRange("all", sunday), { from: "", to: "" });
  assert.deepEqual(timeRange("week", new Date(2026, 0, 1, 12)), {
    from: "2025-12-29",
    to: "2026-01-01",
  });
});
test("summary covers the entire collection, not the current page", () => {
  const entries = Array.from({ length: 125 }, (_, i) => ({
    minutes: 30,
    billable: i < 100,
  }));
  assert.deepEqual(summarizeTime(entries), { total: 3750, billable: 3000 });
  assert.deepEqual(summarizeTime([]), { total: 0, billable: 0 });
});
test("CSV escapes quotes, multiline text, and spreadsheet formulas", () => {
  const csv = timeCsv([
    {
      spentOn: "2026-10-16T00:00:00Z",
      minutes: 30,
      billable: true,
      task: { title: "=1+1" },
      description: 'Une "note"\nSuite',
    },
  ]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"Une ""note""\nSuite"'));
  assert.ok(csv.includes('"2026-10-16"'));
});
