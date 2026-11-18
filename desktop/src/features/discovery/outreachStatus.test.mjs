import assert from "node:assert/strict";
import test from "node:test";

const {
  countOutreachStatusFilters,
  filterByOutreachStatus,
  shouldAutoMarkOutreachInProgress,
} = await import("./outreachStatus.ts");

const person = "a".repeat(64);

function outreach(status) {
  return { status, setBy: person, setByAgent: false, setAt: 1_795_000_000 };
}

test("outreach filter counts use missing status as Not started", () => {
  const records = [
    { outreach: undefined, name: "Untouched" },
    { outreach: outreach("in_progress"), name: "Running" },
    { outreach: outreach("done"), name: "Finished" },
    { outreach: outreach("not_started"), name: "Reset" },
  ];

  assert.deepEqual(
    countOutreachStatusFilters(records, (record) => record.outreach),
    {
      all: 4,
      not_started: 2,
      in_progress: 1,
      done: 1,
    },
  );
  assert.deepEqual(
    filterByOutreachStatus(records, "done", (record) => record.outreach).map(
      (record) => record.name,
    ),
    ["Finished"],
  );
});

test("a created batch auto-marks only absent or Not started outreach", () => {
  assert.equal(shouldAutoMarkOutreachInProgress(undefined), true);
  assert.equal(shouldAutoMarkOutreachInProgress(outreach("not_started")), true);
  assert.equal(
    shouldAutoMarkOutreachInProgress(outreach("in_progress")),
    false,
  );
  assert.equal(shouldAutoMarkOutreachInProgress(outreach("done")), false);
});
