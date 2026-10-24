import assert from "node:assert/strict";
import test from "node:test";

import { isLocalArchiveOn, setLocalArchiveOn } from "./localArchiveSwitch.ts";

const KIND_OBSERVER = 24200;
const KIND_METRIC = 44200;

function makeDeps(initial) {
  const rows = [...initial];
  const calls = { merge: [], remove: [], observer: [], metric: [] };
  return {
    rows,
    calls,
    deps: {
      list: async () => rows.map((row) => ({ ...row })),
      remove: async (scopeType, scopeValue) => {
        calls.remove.push([scopeType, scopeValue]);
        const index = rows.findIndex(
          (row) => row.scopeType === scopeType && row.scopeValue === scopeValue,
        );
        if (index >= 0) rows.splice(index, 1);
        return true;
      },
      merge: async (kind) => {
        calls.merge.push(kind);
        const owner = rows.find((row) => row.scopeType === "owner_p");
        if (owner) {
          if (!owner.kinds.includes(kind)) owner.kinds.push(kind);
        } else {
          rows.push({ scopeType: "owner_p", scopeValue: "me", kinds: [kind] });
        }
      },
      rememberObserverChoice: (pubkey, enabled) =>
        calls.observer.push([pubkey, enabled]),
      rememberMetricChoice: (pubkey, enabled) =>
        calls.metric.push([pubkey, enabled]),
    },
  };
}

const OWNER_ROW = {
  scopeType: "owner_p",
  scopeValue: "me",
  kinds: [KIND_OBSERVER, KIND_METRIC],
};
const CHANNEL_ROW = { scopeType: "channel_h", scopeValue: "c1", kinds: [9] };

test("the switch reads on while any subscription is saved, off with none", () => {
  assert.equal(isLocalArchiveOn([]), false);
  assert.equal(isLocalArchiveOn([OWNER_ROW]), true);
  assert.equal(isLocalArchiveOn([CHANNEL_ROW]), true);
});

test("off deletes every saved subscription, channel ones included, and remembers the opt-out", async () => {
  const { rows, calls, deps } = makeDeps([
    { ...OWNER_ROW, kinds: [...OWNER_ROW.kinds] },
    { ...CHANNEL_ROW },
  ]);
  await setLocalArchiveOn("me", false, deps);
  assert.deepEqual(rows, [], "nothing is left to archive");
  assert.deepEqual(calls.remove, [
    ["owner_p", "me"],
    ["channel_h", "c1"],
  ]);
  assert.deepEqual(calls.observer, [["me", false]]);
  assert.deepEqual(calls.metric, [["me", false]]);
  assert.equal(isLocalArchiveOn(await deps.list()), false);
});

test("on saves the observer and metric defaults and remembers the choice", async () => {
  const { rows, calls, deps } = makeDeps([]);
  await setLocalArchiveOn("me", true, deps);
  assert.deepEqual(calls.merge, [KIND_OBSERVER, KIND_METRIC]);
  assert.deepEqual(rows[0].kinds, [KIND_OBSERVER, KIND_METRIC]);
  assert.deepEqual(calls.observer, [["me", true]]);
  assert.deepEqual(calls.metric, [["me", true]]);
});

test("a failed delete rejects and keeps the remembered choice unchanged", async () => {
  const { calls, deps } = makeDeps([{ ...OWNER_ROW }]);
  deps.remove = async () => {
    throw new Error("disk is busy");
  };
  await assert.rejects(setLocalArchiveOn("me", false, deps), /disk is busy/);
  assert.deepEqual(calls.observer, []);
  assert.deepEqual(calls.metric, []);
});

test("a failed save rejects and does not remember the choice", async () => {
  const { calls, deps } = makeDeps([]);
  deps.merge = async () => {
    throw new Error("cannot save");
  };
  await assert.rejects(setLocalArchiveOn("me", true, deps), /cannot save/);
  assert.deepEqual(calls.observer, []);
});
