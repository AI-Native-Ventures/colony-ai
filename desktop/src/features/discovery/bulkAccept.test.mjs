import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCEPT_CONCURRENCY,
  ACCEPT_RETRY_DELAYS_MS,
  ACCEPT_ROLE_NOTE,
  acceptButtonState,
  acceptProspects,
  acceptSummary,
  reconcileAccepted,
} from "./bulkAccept.ts";

function row(n, { accepted = false } = {}) {
  return {
    eventId: `event-${n}`,
    record: {
      prospectId: `p${n}`,
      status: "active",
      prospect: {
        party: { displayName: `Guesthouse ${n}` },
        saved: accepted,
        qualification: accepted ? "qualified" : "unreviewed",
      },
    },
  };
}

const rows = (count) => Array.from({ length: count }, (_, i) => row(i + 1));
const noSleep = async () => {};

test("any number of selected rows is accepted, 13 and 42 included", async () => {
  for (const count of [2, 13, 42, 200]) {
    const published = [];
    const result = await acceptProspects({
      rows: rows(count),
      publish: async (r) => {
        published.push(r.record.prospectId);
      },
      sleep: noSleep,
    });
    assert.equal(result.accepted.length, count, `count ${count}`);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.alreadyLeads, []);
    assert.equal(new Set(published).size, count, "each row written once");
  }
});

test("writes run with bounded concurrency", async () => {
  let running = 0;
  let peak = 0;
  await acceptProspects({
    rows: rows(30),
    publish: async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
    },
    sleep: noSleep,
  });
  assert.ok(peak > 1, "rows are not written one after another");
  assert.ok(peak <= ACCEPT_CONCURRENCY, `peak ${peak}`);
});

test("rows that are already leads are skipped without a write and counted", async () => {
  const input = [
    row(1),
    row(2, { accepted: true }),
    row(3),
    row(4, { accepted: true }),
  ];
  const published = [];
  const result = await acceptProspects({
    rows: input,
    publish: async (r) => {
      published.push(r.record.prospectId);
    },
    sleep: noSleep,
  });
  assert.deepEqual(published.sort(), ["p1", "p3"]);
  assert.deepEqual(result.alreadyLeads, ["p2", "p4"]);
  assert.equal(result.accepted.length, 2);
  assert.match(acceptSummary(result), /2 were already leads\./);
});

test("a row that fails is retried, then reported with its reason, and the rest are still saved", async () => {
  const attempts = new Map();
  const sleeps = [];
  const result = await acceptProspects({
    rows: rows(13),
    publish: async (r) => {
      const id = r.record.prospectId;
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      if (id === "p3" || id === "p9") throw new Error("Relay is busy.");
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  assert.equal(result.accepted.length, 11);
  assert.deepEqual(
    result.failed.map((f) => [f.prospectId, f.name, f.message]).sort(),
    [
      ["p3", "Guesthouse 3", "Relay is busy."],
      ["p9", "Guesthouse 9", "Relay is busy."],
    ],
  );
  assert.equal(attempts.get("p3"), ACCEPT_RETRY_DELAYS_MS.length + 1);
  assert.equal(attempts.get("p1"), 1, "saved rows are not retried");
  assert.deepEqual(
    sleeps.sort((a, b) => a - b),
    [...ACCEPT_RETRY_DELAYS_MS, ...ACCEPT_RETRY_DELAYS_MS].sort(
      (a, b) => a - b,
    ),
  );
  const summary = acceptSummary(result);
  assert.match(summary, /^Accepted 11 of 13 as leads\./);
  assert.match(
    summary,
    /2 prospects could not be saved \(Guesthouse \d, Guesthouse \d\): Relay is busy\./,
  );
  assert.match(summary, /stay selected/);
});

test("a one-off failure is absorbed by the retry", async () => {
  let calls = 0;
  const result = await acceptProspects({
    rows: rows(3),
    publish: async (r) => {
      if (r.record.prospectId === "p2") {
        calls += 1;
        if (calls === 1) throw new Error("blip");
      }
    },
    sleep: noSleep,
  });
  assert.equal(result.accepted.length, 3);
  assert.deepEqual(result.failed, []);
  assert.equal(calls, 2);
});

test("a failure with no message gets a plain fallback, never a blank", async () => {
  const result = await acceptProspects({
    rows: rows(1),
    publish: async () => {
      throw new Error("");
    },
    sleep: noSleep,
  });
  assert.match(result.failed[0].message, /could not be saved/);
});

test("progress counts finished rows up to the total", async () => {
  const seen = [];
  await acceptProspects({
    rows: [...rows(5), row(6, { accepted: true })],
    publish: async () => {},
    sleep: noSleep,
    onProgress: (progress) => seen.push(progress),
  });
  assert.deepEqual(seen[0], { done: 0, total: 5 });
  assert.deepEqual(seen.at(-1), { done: 5, total: 5 });
  assert.ok(seen.every((p) => p.done <= p.total));
});

test("the same row twice in a selection is written once", async () => {
  let writes = 0;
  const result = await acceptProspects({
    rows: [row(1), row(1)],
    publish: async () => {
      writes += 1;
    },
    sleep: noSleep,
  });
  assert.equal(writes, 1);
  assert.equal(result.accepted.length, 1);
});

test("a failed row that the refreshed list shows as a lead counts as accepted", () => {
  const result = {
    accepted: ["p1"],
    alreadyLeads: [],
    failed: [
      { prospectId: "p2", name: "Guesthouse 2", message: "lost answer" },
      { prospectId: "p3", name: "Guesthouse 3", message: "busy" },
    ],
  };
  const reconciled = reconcileAccepted(result, [
    row(2, { accepted: true }),
    row(3),
  ]);
  assert.deepEqual(reconciled.accepted, ["p1", "p2"]);
  assert.deepEqual(
    reconciled.failed.map((f) => f.prospectId),
    ["p3"],
  );
  assert.equal(reconcileAccepted(result, [row(2), row(3)]), result);
});

test("the summary is plain words with no dash punctuation", () => {
  const all = acceptSummary({
    accepted: ["a", "b", "c"],
    alreadyLeads: [],
    failed: [],
  });
  assert.equal(all, "Accepted 3 prospects as leads.");
  assert.equal(
    acceptSummary({ accepted: ["a"], alreadyLeads: ["b"], failed: [] }),
    "Accepted 1 prospect as a lead. 1 was already a lead.",
  );
  assert.equal(
    acceptSummary({ accepted: [], alreadyLeads: ["a", "b"], failed: [] }),
    "Nothing to accept. 2 were already leads.",
  );
  const failed = acceptSummary({
    accepted: ["a"],
    alreadyLeads: [],
    failed: ["w", "x", "y", "z"].map((n) => ({
      prospectId: n,
      name: `Guesthouse ${n}`,
      message: "Relay is busy.",
    })),
  });
  assert.match(failed, /and 1 more/);
  for (const text of [all, failed]) {
    assert.ok(!text.includes("—"), "no em dash");
  }
});

test("the Accept button names the count and says why when it cannot apply", () => {
  const state = (selected, extra = {}) =>
    acceptButtonState({
      rows: selected,
      canWrite: true,
      progress: null,
      ...extra,
    });

  assert.deepEqual(state(rows(1)), {
    label: "Accept as lead",
    disabled: false,
    note: null,
  });
  for (const count of [2, 13, 42]) {
    const button = state(rows(count));
    assert.equal(button.label, `Accept ${count} as leads`);
    assert.equal(button.disabled, false);
    assert.equal(button.note, null);
  }

  const mixed = state([row(1), row(2), row(3, { accepted: true })]);
  assert.equal(mixed.label, "Accept 2 as leads");
  assert.equal(mixed.disabled, false);
  assert.equal(mixed.note, "1 selected is already a lead and will be skipped.");

  const allDone = state([
    row(1, { accepted: true }),
    row(2, { accepted: true }),
  ]);
  assert.equal(allDone.disabled, true);
  assert.equal(allDone.note, "All 2 selected are already leads.");
  assert.equal(
    state([row(1, { accepted: true })]).note,
    "This prospect is already a lead.",
  );

  const viewer = state(rows(13), { canWrite: false });
  assert.equal(viewer.disabled, true);
  assert.equal(viewer.note, ACCEPT_ROLE_NOTE);
  assert.equal(viewer.label, "Accept 13 as leads");

  const busy = state(rows(13), { progress: { done: 4, total: 13 } });
  assert.equal(busy.disabled, true);
  assert.equal(busy.label, "Accepting 5 of 13…");

  // A grey button always has a reason.
  for (const button of [allDone, viewer]) {
    assert.ok(button.disabled && button.note);
  }
  for (const text of [allDone.note, viewer.note, mixed.note]) {
    assert.ok(!text.includes("—"));
  }
});
