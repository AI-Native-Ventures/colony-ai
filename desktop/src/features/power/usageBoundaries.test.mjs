import assert from "node:assert/strict";
import test from "node:test";

import { usageBucketBoundaries } from "./usageBoundaries.ts";

test("usage boundaries are adjacent local midnights for seven and thirty days", () => {
  const now = new Date(2026, 8, 25, 12, 30, 0);
  for (const days of [7, 30]) {
    const boundaries = usageBucketBoundaries(now, days);
    assert.equal(boundaries.length, days + 1);
    const dates = boundaries.map((second) => new Date(second * 1000));
    assert.ok(dates.every((date) => date.getHours() === 0));
    assert.ok(
      boundaries.every(
        (value, index) => index === 0 || value > boundaries[index - 1],
      ),
    );
  }
});

test("usage boundaries remain calendar based across a daylight-saving change", () => {
  const priorTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const now = new Date("2025-03-09T12:00:00-04:00");
    const boundaries = usageBucketBoundaries(now, 7);
    assert.equal(boundaries.length, 8);
    const dayLengths = boundaries
      .slice(1)
      .map((value, index) => value - boundaries[index]);
    assert.ok(dayLengths.includes(23 * 60 * 60));
    assert.ok(dayLengths.includes(24 * 60 * 60));
  } finally {
    if (priorTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = priorTimezone;
  }
});
