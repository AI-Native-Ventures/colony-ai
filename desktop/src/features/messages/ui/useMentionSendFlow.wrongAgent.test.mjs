import assert from "node:assert/strict";
import { test } from "node:test";

import { KEY, setup } from "./useMentionSendFlow.test-support.mjs";

/**
 * GATE-312 R4 P9 (29 Oct, 3.0.12): the owner mentioned a Scout that has no
 * runtime on this Mac while the Scout this Mac runs was not addressed. The
 * message went out, nothing woke, and nothing said why. These drive the real
 * send flow and pin that the send says so once, and only then.
 */

const LOCAL_KEY = "c".repeat(64);
const scout = (pubkey) => ({
  pubkey,
  name: "RemoteScout",
  status: "running",
  backend: { type: "local" },
});

test("mentioning a same-name agent that is not the one on this Mac says so", async () => {
  const s = await setup({
    members: [KEY],
    agents: [scout(LOCAL_KEY)],
    reads: [[scout(LOCAL_KEY)]],
  });
  assert.equal(s.events("SEND").length, 1, "the message still goes out");
  const warnings = s.events("warning");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][1], /RemoteScout/);
  assert.match(warnings[0][1], /different agent/);
});

test("mentioning the agent this Mac runs says nothing", async () => {
  const s = await setup({
    members: [KEY],
    agents: [scout(KEY)],
    reads: [[scout(KEY)]],
  });
  assert.equal(s.events("SEND").length, 1);
  assert.equal(s.events("warning").length, 0);
});

test("mentioning an agent no local agent shares a name with says nothing", async () => {
  const s = await setup({
    members: [KEY],
    agents: [{ ...scout(LOCAL_KEY), name: "Other" }],
    reads: [[{ ...scout(LOCAL_KEY), name: "Other" }]],
  });
  assert.equal(s.events("SEND").length, 1);
  assert.equal(s.events("warning").length, 0);
});
