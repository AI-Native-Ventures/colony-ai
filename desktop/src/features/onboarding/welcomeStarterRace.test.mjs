import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  resetAgentLifecycle,
  trackAgentStart,
} from "../agents/agentLifecycle.ts";
import {
  registerAgentStartWatch,
  resetAgentStartWatches,
} from "../agents/agentStartWatch.ts";
import { reconcileWelcomeStarter } from "./welcomeGuide.ts";

const SCOUT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const NOW_SECONDS = 1_793_016_886; // 12:14:46Z, the GATE-304 mention

// 3.0.4 changed Scout's launch settings, so every existing Scout drifted.
const DESIRED = {
  name: "Scout",
  agentCommand: "codex-acp",
  agentArgs: [],
  mcpCommand: "",
  parallelism: 1,
};

const scout = (status) => ({
  pubkey: SCOUT,
  name: "Scout",
  personaId: "builtin:fizz",
  agentCommand: "opencode",
  agentArgs: ["acp"],
  mcpCommand: "",
  parallelism: 1,
  systemPrompt: null,
  status,
  backend: { type: "local" },
});

/** Everything the reconcile touches, recording the order it happened in. */
function rig({ stopped = false, updateFails = false, startFailures = 0 } = {}) {
  const calls = [];
  let failuresLeft = startFailures;
  return {
    calls,
    stop: async (pubkey, reason) => {
      calls.push(["stop", pubkey, reason]);
    },
    update: async (input) => {
      calls.push(["update", input.agentCommand]);
      if (updateFails) throw new Error("update refused");
      return { agent: { ...scout(stopped ? "stopped" : "running"), ...input } };
    },
    start: async (pubkey) => {
      calls.push(["start", pubkey]);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("spawn failed");
      }
      return { ...scout("running"), agentCommand: "codex-acp" };
    },
  };
}

const waitOn = () =>
  registerAgentStartWatch({
    pubkey: SCOUT,
    channelId: "welcome",
    threadHeadId: null,
    floorUnix: NOW_SECONDS,
    start: async () => {},
  });

afterEach(() => {
  resetAgentStartWatches();
  resetAgentLifecycle();
});

describe("reconcileWelcomeStarter against a mention being answered", () => {
  it("does not stop a starter somebody is waiting on: the new settings wait for its next start", async () => {
    waitOn();
    const r = rig();
    const result = await reconcileWelcomeStarter(
      scout("running"),
      DESIRED,
      r.stop,
      r.update,
      { start: r.start, runtimeDefaultArgs: [] },
    );
    assert.deepEqual(r.calls, [["update", "codex-acp"]]);
    assert.equal(result.status, "running");
  });

  it("decides from the starter as it is now, not from the read taken before the slow awaits", async () => {
    const r = rig();
    // The first read said stopped; the send flow's start has run since.
    await reconcileWelcomeStarter(scout("stopped"), DESIRED, r.stop, r.update, {
      start: r.start,
      runtimeDefaultArgs: [],
      reload: async () => scout("running"),
    });
    assert.deepEqual(
      r.calls.map((call) => call[0]),
      ["stop", "update", "start"],
    );
  });

  it("leaves a starter alone that is no longer running by the time it is read", async () => {
    const r = rig({ stopped: true });
    await reconcileWelcomeStarter(scout("running"), DESIRED, r.stop, r.update, {
      start: r.start,
      runtimeDefaultArgs: [],
      reload: async () => scout("stopped"),
    });
    assert.deepEqual(
      r.calls.map((call) => call[0]),
      ["update"],
    );
  });

  it("falls back to the earlier read when the host cannot be read again", async () => {
    const r = rig();
    await reconcileWelcomeStarter(scout("running"), DESIRED, r.stop, r.update, {
      start: r.start,
      runtimeDefaultArgs: [],
      reload: async () => {
        throw new Error("host busy");
      },
    });
    assert.deepEqual(
      r.calls.map((call) => call[0]),
      ["stop", "update", "start"],
    );
  });

  it("names itself in the stop it asks for", async () => {
    const r = rig();
    await reconcileWelcomeStarter(scout("running"), DESIRED, r.stop, r.update, {
      start: r.start,
      runtimeDefaultArgs: [],
    });
    assert.match(r.calls[0][2], /^welcome starter reconcile: /);
  });

  it("queues behind a start that is in flight instead of stopping the agent mid-start", async () => {
    let finishStart;
    const startInFlight = new Promise((resolve) => {
      finishStart = resolve;
    });
    trackAgentStart(SCOUT, startInFlight);
    waitOn(); // the mention that start was for
    const r = rig();
    const reconcile = reconcileWelcomeStarter(
      scout("stopped"),
      DESIRED,
      r.stop,
      r.update,
      {
        start: r.start,
        runtimeDefaultArgs: [],
        reload: async () => scout("running"),
      },
    );
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    assert.deepEqual(r.calls, [], "nothing touched the agent mid-start");
    finishStart();
    await startInFlight;
    await reconcile;
    // The start finished, the agent is running and is waited on: no stop.
    assert.deepEqual(
      r.calls.map((call) => call[0]),
      ["update"],
    );
  });

  it("starts the starter again even when the update fails, then reports the failure", async () => {
    const r = rig({ updateFails: true });
    await assert.rejects(
      reconcileWelcomeStarter(scout("running"), DESIRED, r.stop, r.update, {
        start: r.start,
        runtimeDefaultArgs: [],
      }),
      /update refused/,
    );
    assert.deepEqual(
      r.calls.map((call) => call[0]),
      ["stop", "update", "start"],
    );
  });

  it("tries once more when the first start after the stop fails", async () => {
    const r = rig({ startFailures: 1 });
    const result = await reconcileWelcomeStarter(
      scout("running"),
      DESIRED,
      r.stop,
      r.update,
      { start: r.start, runtimeDefaultArgs: [], retryDelayMs: 0 },
    );
    assert.deepEqual(
      r.calls.map((call) => call[0]),
      ["stop", "update", "start", "start"],
    );
    assert.equal(result.status, "running");
  });

  it("reports a start that fails twice rather than leaving the agent down in silence", async () => {
    const r = rig({ startFailures: 2 });
    await assert.rejects(
      reconcileWelcomeStarter(scout("running"), DESIRED, r.stop, r.update, {
        start: r.start,
        runtimeDefaultArgs: [],
        retryDelayMs: 0,
      }),
      /spawn failed/,
    );
  });
});
