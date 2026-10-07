import assert from "node:assert/strict";
import test from "node:test";

import { surfaceNestMigrationNotice } from "./nestMigrationNotice.ts";

function makeDeps({ notice = null, cancelled = false, failShow = false } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      fetchNotice: async () => {
        calls.push("fetch");
        if (notice instanceof Error) throw notice;
        return notice;
      },
      acknowledge: async () => {
        calls.push("acknowledge");
      },
      show: (message) => {
        calls.push(`show:${message}`);
        if (failShow) throw new Error("toast failed");
      },
      isCancelled: () => cancelled,
    },
  };
}

const NOTICE = {
  key: "migrated",
  message: "Colony moved your agents' files to a new folder.",
  acknowledged: false,
};

test("shows a pending notice once and acknowledges it after showing", async () => {
  const { deps, calls } = makeDeps({ notice: NOTICE });
  assert.equal(await surfaceNestMigrationNotice(deps), true);
  assert.deepEqual(calls, ["fetch", `show:${NOTICE.message}`, "acknowledge"]);
});

test("does nothing when there is no notice", async () => {
  const { deps, calls } = makeDeps({ notice: null });
  assert.equal(await surfaceNestMigrationNotice(deps), false);
  assert.deepEqual(calls, ["fetch"]);
});

test("does nothing for a notice that was already seen", async () => {
  const { deps, calls } = makeDeps({
    notice: { ...NOTICE, acknowledged: true },
  });
  assert.equal(await surfaceNestMigrationNotice(deps), false);
  assert.deepEqual(calls, ["fetch"]);
});

test("a cancelled caller shows nothing and leaves the notice for next launch", async () => {
  const { deps, calls } = makeDeps({ notice: NOTICE, cancelled: true });
  assert.equal(await surfaceNestMigrationNotice(deps), false);
  assert.deepEqual(calls, ["fetch"]);
});

test("a failing fetch is swallowed", async () => {
  const { deps } = makeDeps({ notice: new Error("backend gone") });
  assert.equal(await surfaceNestMigrationNotice(deps), false);
});

test("a notice that could not be shown is not acknowledged", async () => {
  const { deps, calls } = makeDeps({ notice: NOTICE, failShow: true });
  assert.equal(await surfaceNestMigrationNotice(deps), false);
  assert.deepEqual(calls, ["fetch", `show:${NOTICE.message}`]);
});
