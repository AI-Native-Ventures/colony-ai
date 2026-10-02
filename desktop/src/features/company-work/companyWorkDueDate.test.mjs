import assert from "node:assert/strict";
import test from "node:test";

import {
  formatCompanyWorkDueDate,
  isCompanyWorkOverdue,
} from "./companyWorkDueDate.ts";

test("formats saved dates in the selected IANA timezone", () => {
  assert.equal(
    formatCompanyWorkDueDate("2026-10-09T14:00:00Z", "Africa/Johannesburg"),
    "2026-10-09T16:00 · Africa/Johannesburg",
  );
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
