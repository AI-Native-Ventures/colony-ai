import assert from "node:assert/strict";
import test from "node:test";

const {
  countOutreachStatusFilters,
  filterByOutreachStatus,
  outreachStatusFor,
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

test("effective outreach status derives from the list progress unless someone set it", () => {
  assert.equal(
    outreachStatusFor(undefined, { total: 4, messaged: 0, resolved: 0 }),
    "not_started",
  );
  assert.equal(
    outreachStatusFor(undefined, { total: 4, messaged: 1, resolved: 1 }),
    "in_progress",
  );
  assert.equal(
    outreachStatusFor(undefined, { total: 4, messaged: 2, resolved: 4 }),
    "done",
  );
  assert.equal(
    outreachStatusFor(undefined, { total: 2, messaged: 0, resolved: 2 }),
    "done",
  );
  assert.equal(
    outreachStatusFor(outreach("not_started"), {
      total: 4,
      messaged: 4,
      resolved: 4,
    }),
    "not_started",
  );
});

test("filter counts accept the effective status the Lists screen supplies", () => {
  const records = [
    {
      name: "Untouched",
      outreach: undefined,
      progress: { total: 2, messaged: 0, resolved: 0 },
    },
    {
      name: "Partly messaged",
      outreach: undefined,
      progress: { total: 2, messaged: 1, resolved: 1 },
    },
    {
      name: "Complete",
      outreach: undefined,
      progress: { total: 2, messaged: 1, resolved: 2 },
    },
    {
      name: "Explicitly paused",
      outreach: outreach("not_started"),
      progress: { total: 2, messaged: 2, resolved: 2 },
    },
  ];
  const effectiveStatus = (record) =>
    outreachStatusFor(record.outreach, record.progress);

  assert.deepEqual(countOutreachStatusFilters(records, effectiveStatus), {
    all: 4,
    not_started: 2,
    in_progress: 1,
    done: 1,
  });
  assert.deepEqual(
    filterByOutreachStatus(records, "not_started", effectiveStatus).map(
      (record) => record.name,
    ),
    ["Untouched", "Explicitly paused"],
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
