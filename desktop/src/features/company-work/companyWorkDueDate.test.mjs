import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompanyWorkDueDate,
  isCompanyWorkOverdue,
  localDateTimeInputToUtc,
} from "./companyWorkDueDate.ts";

test("formats saved dates in the selected IANA timezone", () => {
  assert.equal(
    formatCompanyWorkDueDate("2026-10-09T14:00:00Z", "Africa/Johannesburg"),
    "2026-10-09T16:00 · Africa/Johannesburg",
  );
});

test("converts local input to a UTC instant", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Africa/Johannesburg";
  try {
    assert.equal(
      localDateTimeInputToUtc("2026-10-09T16:00"),
      "2026-10-09T14:00:00Z",
    );
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("rejects incomplete, impossible, and daylight-saving gap times", () => {
  assert.equal(localDateTimeInputToUtc(""), null);
  assert.equal(localDateTimeInputToUtc("2026-02-30T12:00"), null);
  const previousTimezone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    assert.equal(localDateTimeInputToUtc("2026-03-08T02:30"), null);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("derives overdue only from an elapsed saved due date on open work", () => {
  const now = Date.parse("2026-10-10T00:00:00Z");
  assert.equal(
    isCompanyWorkOverdue("2026-10-09T23:59:59Z", "active", now),
    true,
  );
  assert.equal(
    isCompanyWorkOverdue("2026-10-10T00:00:00Z", "active", now),
    false,
  );
  assert.equal(isCompanyWorkOverdue(undefined, "active", now), false);
  assert.equal(
    isCompanyWorkOverdue("2026-10-09T00:00:00Z", "done_unverified", now),
    false,
  );
  assert.equal(
    isCompanyWorkOverdue("2026-10-09T00:00:00Z", "archived", now),
    false,
  );
});
