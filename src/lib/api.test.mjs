import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateOnly } from "./api.js";

test("formatDateOnly keeps a UTC workday on its recorded calendar date", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const workday = "2026-10-11T00:00:00.000Z";
    assert.equal(formatDateOnly(workday), "11 oct. 2026");
    assert.equal(formatDate(workday), "10 oct. 2026");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
