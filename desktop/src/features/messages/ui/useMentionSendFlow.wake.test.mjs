import assert from "node:assert/strict";
import { test } from "node:test";

import { KEY, setup } from "./useMentionSendFlow.test-support.mjs";

/**
 * GATE-303 (26 Oct, published 3.0.3): a mention sent 3.6 s after launch to a
 * stopped Scout got no wake, no "starting" notice and no error, and nothing
 * ever looked at it again. These drive the real send flow, with only the
 * query/mutation edges stubbed, and pin what it must do whatever state the
 * app was in when the person pressed send.
 */

const localScout = (status) => ({
  pubkey: KEY,
  name: "LocalScout",
  status,
  backend: { type: "local" },
});

const woken = (s) => s.control.watches.filter((watch) => watch.pubkey === KEY);

test("a mention sent before the managed agents load still wakes the agent", async () => {
  // Launch: nothing cached, and the host answers only after two failed reads.
  const s = await setup({
    members: [KEY],
    agents: undefined,
    reads: [
      new Error("host not ready"),
      new Error("host not ready"),
      [localScout("stopped")],
    ],
  });
  assert.equal(s.events("SEND").length, 1);
  assert.equal(woken(s).length, 1, "the stopped agent was woken");
  assert.equal(s.query.refetchCalls, 3);
});

test("a mention sent while the host never answers is sent, not dropped, and handed to the reconciler", async () => {
  const s = await setup({
    members: [KEY],
    agents: undefined,
    reads: Array.from({ length: 12 }, () => new Error("host not ready")),
  });
  // The person's message goes out. No wake could be decided from a list that
  // never loaded, so the relay-side check is asked to follow it up.
  assert.equal(s.events("SEND").length, 1);
  assert.deepEqual(s.control.notes, [[KEY]]);
});

test("an agent the cache calls running but whose harness died is woken", async () => {
  // The cache still says running; the host, which looks at the process, says
  // stopped.
  const s = await setup({
    members: [KEY],
    agents: [localScout("running")],
    reads: [[localScout("stopped")]],
  });
  assert.equal(s.query.refetchCalls, 1);
  assert.equal(woken(s).length, 1);
});

test("an agent that really is running is not woken again", async () => {
  const s = await setup({
    members: [KEY],
    agents: [localScout("running")],
    reads: [[localScout("running")]],
  });
  assert.equal(woken(s).length, 0);
  assert.equal(s.events("SEND").length, 1);
});

test("every send that mentions someone asks the reconciler to follow it up", async () => {
  const s = await setup({
    members: [KEY],
    agents: [localScout("running")],
    reads: [[localScout("running")]],
  });
  assert.deepEqual(s.control.notes, [[KEY]]);
});
