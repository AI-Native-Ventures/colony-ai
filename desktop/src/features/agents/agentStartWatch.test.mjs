import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import {
  AGENT_START_RETRY_AFTER_MS,
  beginAgentStartAttempt,
  AGENT_START_STALLED_AFTER_MS,
  AGENT_START_WATCH_TTL_MS,
  failAgentStartWatches,
  getAgentStartWatches,
  hasAgentStartWatch,
  lowerAgentStartFloor,
  registerAgentStartWatch,
  resetAgentStartWatches,
  resolveAgentStartWatches,
  retryAgentStart,
  stallAgentStartWatches,
  subscribeAgentStartWatches,
} from "./agentStartWatch.ts";
import {
  reportChannelBotTyping,
  resetAgentWorkingSignal,
} from "./agentWorkingSignal.ts";
import { resetActiveAgentTurnsStore } from "./activeAgentTurnsStore.ts";

const SCOUT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const WRITER =
  "dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321";
const WELCOME = "channel-welcome";
const GENERAL = "channel-general";

// 26 Oct 2026 03:00:27Z, the first mention in the packaged-app incident.
const T0_MS = 1_792_983_627_000;
const FLOOR_FIRST = 1_792_983_627;
const FLOOR_SECOND = 1_792_984_149;

/** A start runner that records its calls and settles as the test decides. */
function makeRunner(outcome = "resolve") {
  const calls = [];
  const runner = (attempt) => {
    calls.push(attempt);
    return outcome === "reject"
      ? Promise.reject(new Error("spawn failed"))
      : Promise.resolve({ pubkey: SCOUT });
  };
  return { calls, runner };
}

function register(overrides = {}) {
  const { runner } = makeRunner();
  return registerAgentStartWatch({
    pubkey: SCOUT,
    channelId: WELCOME,
    threadHeadId: null,
    floorUnix: FLOOR_FIRST,
    start: runner,
    ...overrides,
  });
}

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0_MS });
  resetAgentStartWatches();
  resetActiveAgentTurnsStore();
  resetAgentWorkingSignal();
});

afterEach(() => {
  resetAgentStartWatches();
  mock.timers.reset();
});

describe("replay floor", () => {
  it("is the send's own floor for the first unanswered mention", () => {
    assert.deepEqual(register(), { floorUnix: FLOOR_FIRST });
  });

  it("reaches back to the OLDEST unanswered mention, not the newest", () => {
    register({ floorUnix: FLOOR_FIRST });
    mock.timers.tick(9 * 60 * 1000);
    // The second mention arrives nine minutes later (03:09:09 in the incident).
    assert.deepEqual(register({ floorUnix: FLOOR_SECOND }), {
      floorUnix: FLOOR_FIRST,
    });
  });

  it("reaches back across channels for the same agent", () => {
    register({ channelId: WELCOME, floorUnix: FLOOR_FIRST });
    assert.deepEqual(
      register({ channelId: GENERAL, floorUnix: FLOOR_SECOND }),
      { floorUnix: FLOOR_FIRST },
    );
  });

  it("does not mix agents", () => {
    register({ pubkey: SCOUT, floorUnix: FLOOR_FIRST });
    assert.deepEqual(register({ pubkey: WRITER, floorUnix: FLOOR_SECOND }), {
      floorUnix: FLOOR_SECOND,
    });
  });

  it("starts fresh once the agent picked the mention up", () => {
    register({ floorUnix: FLOOR_FIRST });
    resolveAgentStartWatches(SCOUT);
    assert.deepEqual(register({ floorUnix: FLOOR_SECOND }), {
      floorUnix: FLOOR_SECOND,
    });
  });

  it("forgets a floor older than the harness can replay", () => {
    register({ floorUnix: FLOOR_FIRST });
    mock.timers.tick(AGENT_START_WATCH_TTL_MS + 1000);
    assert.deepEqual(register({ floorUnix: FLOOR_SECOND }), {
      floorUnix: FLOOR_SECOND,
    });
  });
});

describe("watching a start", () => {
  it("lists the agent as starting in the channel it was mentioned in", () => {
    register();
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.pubkey, SCOUT);
    assert.equal(watch.phase, "starting");
    assert.equal(watch.since, T0_MS);
    assert.equal(watch.threadHeadId, null);
    assert.deepEqual(getAgentStartWatches(GENERAL), []);
  });

  it("keeps the same list while nothing changes", () => {
    register();
    assert.equal(getAgentStartWatches(WELCOME), getAgentStartWatches(WELCOME));
  });

  it("tells subscribers about every change", () => {
    let calls = 0;
    const unsubscribe = subscribeAgentStartWatches(() => {
      calls += 1;
    });
    register();
    resolveAgentStartWatches(SCOUT);
    unsubscribe();
    register();
    assert.equal(calls, 2);
  });

  it("restarts the agent once if nobody picked the mention up", async () => {
    const { calls, runner } = makeRunner();
    register({ start: runner, floorUnix: FLOOR_FIRST });
    mock.timers.tick(AGENT_START_RETRY_AFTER_MS - 1);
    assert.equal(calls.length, 0);
    mock.timers.tick(1);
    assert.deepEqual(calls, [{ force: false, floorUnix: FLOOR_FIRST }]);
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    assert.equal(calls.length, 1, "the automatic restart happens once");
  });

  it("replays the oldest mention when the automatic restart fires", () => {
    const { calls, runner } = makeRunner();
    register({ start: runner, floorUnix: FLOOR_FIRST });
    mock.timers.tick(5000);
    register({ start: runner, channelId: GENERAL, floorUnix: FLOOR_SECOND });
    mock.timers.tick(AGENT_START_RETRY_AFTER_MS);
    assert.equal(calls.length, 1, "two channels, one restart");
    assert.equal(calls[0].floorUnix, FLOOR_FIRST);
  });

  it("does not restart an agent that picked the mention up", () => {
    const { calls, runner } = makeRunner();
    register({ start: runner });
    mock.timers.tick(5000);
    resolveAgentStartWatches(SCOUT);
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS * 2);
    assert.equal(calls.length, 0);
    assert.deepEqual(getAgentStartWatches(WELCOME), []);
  });

  it("calls a start that stays silent stalled after a bounded time", () => {
    register();
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS - 1);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "starting");
    mock.timers.tick(1);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "stalled");
  });

  it("calls a start that failed outright stalled at once, with the reason", () => {
    register();
    failAgentStartWatches(SCOUT, "spawn failed");
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "stalled");
    assert.equal(watch.reason, "spawn failed");
  });

  it("stalls when the automatic restart is refused", async () => {
    const { runner } = makeRunner("reject");
    register({ start: runner });
    mock.timers.tick(AGENT_START_RETRY_AFTER_MS);
    await new Promise((resolve) => setImmediate(resolve));
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "stalled");
    assert.equal(watch.reason, "spawn failed");
  });

  it("clears when the agent shows up working anywhere", () => {
    register();
    reportChannelBotTyping(GENERAL, [SCOUT]);
    assert.deepEqual(getAgentStartWatches(WELCOME), []);
  });

  it("starts the countdown over when the person mentions again after a stall", () => {
    register();
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "stalled");
    mock.timers.tick(1000);
    register({ floorUnix: FLOOR_SECOND });
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "starting");
    assert.equal(watch.since, T0_MS + AGENT_START_STALLED_AFTER_MS + 1000);
    assert.equal(
      watch.floorUnix,
      FLOOR_FIRST,
      "the oldest mention still counts",
    );
  });
});

describe("a late failure", () => {
  it("is ignored once a newer start attempt began", () => {
    register();
    const first = beginAgentStartAttempt(SCOUT);
    beginAgentStartAttempt(SCOUT);
    failAgentStartWatches(SCOUT, "spawn failed", first);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "starting");
  });

  it("counts when it comes from the latest attempt", () => {
    register();
    beginAgentStartAttempt(SCOUT);
    const latest = beginAgentStartAttempt(SCOUT);
    failAgentStartWatches(SCOUT, "spawn failed", latest);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "stalled");
  });

  it("from the automatic restart cannot stall a retry the person already started", async () => {
    let rejectAuto;
    const calls = [];
    const runner = (attempt) => {
      calls.push(attempt);
      return calls.length === 1
        ? new Promise((_, reject) => {
            rejectAuto = reject;
          })
        : new Promise(() => {});
    };
    register({ start: runner });
    mock.timers.tick(AGENT_START_RETRY_AFTER_MS);
    retryAgentStart(SCOUT);
    assert.equal(calls.length, 2);
    rejectAuto(new Error("spawn failed"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "starting");
  });
});

describe("try again", () => {
  it("replaces the harness and replays the oldest mention", () => {
    const { calls, runner } = makeRunner();
    register({ start: runner, floorUnix: FLOOR_FIRST });
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    calls.length = 0;
    retryAgentStart(SCOUT);
    assert.deepEqual(calls, [{ force: true, floorUnix: FLOOR_FIRST }]);
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "starting");
    assert.equal(watch.reason, null);
  });

  it("gives the retry a fresh countdown before it stalls again", () => {
    register();
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    retryAgentStart(SCOUT);
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS - 1);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "starting");
    mock.timers.tick(1);
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "stalled");
  });

  it("stalls again, with the reason, if the retry itself is refused", async () => {
    const { runner } = makeRunner("reject");
    register({ start: runner });
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    retryAgentStart(SCOUT);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "stalled");
    assert.equal(getAgentStartWatches(WELCOME)[0].reason, "spawn failed");
  });

  it("does nothing for an agent nobody is waiting on", () => {
    assert.doesNotThrow(() => retryAgentStart(WRITER));
  });
});

describe("reset", () => {
  it("drops every watch and cancels its timers", () => {
    const { calls, runner } = makeRunner();
    register({ start: runner });
    resetAgentStartWatches();
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS * 2);
    assert.equal(calls.length, 0);
    assert.deepEqual(getAgentStartWatches(WELCOME), []);
  });
});

describe("quiet watches (an agent believed to be running)", () => {
  it("starts quiet, and still restarts once and stalls like any other", () => {
    const { calls, runner } = makeRunner();
    register({ start: runner, quiet: true });
    assert.equal(getAgentStartWatches(WELCOME)[0].quiet, true);
    mock.timers.tick(AGENT_START_RETRY_AFTER_MS);
    assert.equal(calls.length, 1);
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "stalled");
  });

  it("is loud once a start is registered for the same wait", () => {
    register({ quiet: true });
    register({ quiet: false });
    assert.equal(getAgentStartWatches(WELCOME)[0].quiet, false);
  });

  it("does not take a notice back once the person has been told", () => {
    register({ quiet: false });
    register({ quiet: true });
    assert.equal(getAgentStartWatches(WELCOME)[0].quiet, false);
  });

  it("is loud again after a failed start or a retry", () => {
    register({ quiet: true });
    failAgentStartWatches(SCOUT, "spawn failed");
    assert.equal(getAgentStartWatches(WELCOME)[0].quiet, false);
    resetAgentStartWatches();
    register({ quiet: true });
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS);
    retryAgentStart(SCOUT);
    assert.equal(getAgentStartWatches(WELCOME)[0].quiet, false);
  });
});

describe("lowerAgentStartFloor", () => {
  it("reaches the next start back to an older mention the relay showed", () => {
    register({ floorUnix: FLOOR_SECOND });
    lowerAgentStartFloor(SCOUT, FLOOR_FIRST);
    const { floorUnix } = register({ floorUnix: FLOOR_SECOND });
    assert.equal(floorUnix, FLOOR_FIRST);
  });

  it("never moves a floor forward", () => {
    register({ floorUnix: FLOOR_FIRST });
    lowerAgentStartFloor(SCOUT, FLOOR_SECOND);
    assert.equal(register({ floorUnix: FLOOR_SECOND }).floorUnix, FLOOR_FIRST);
  });

  it("leaves another agent's floor alone", () => {
    register({ pubkey: WRITER, floorUnix: FLOOR_SECOND });
    lowerAgentStartFloor(SCOUT, FLOOR_FIRST);
    assert.equal(
      register({ pubkey: WRITER, floorUnix: FLOOR_SECOND }).floorUnix,
      FLOOR_SECOND,
    );
  });
});

describe("an agent that started and went away", () => {
  it("is stalled at once, with its own note, and is not restarted behind the person's back", () => {
    const { calls, runner } = makeRunner();
    register({ start: runner });
    stallAgentStartWatches(SCOUT, "Scout keeps stopping before it answers.");
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "stalled");
    assert.equal(watch.note, "Scout keeps stopping before it answers.");
    assert.equal(watch.reason, null, "the start did not fail");
    mock.timers.tick(AGENT_START_STALLED_AFTER_MS * 2);
    assert.equal(calls.length, 0);
  });

  it("loses the note when the person tries again", () => {
    register();
    stallAgentStartWatches(SCOUT, "Scout stopped while working on this.");
    retryAgentStart(SCOUT);
    const [watch] = getAgentStartWatches(WELCOME);
    assert.equal(watch.phase, "starting");
    assert.equal(watch.note, null);
  });

  it("leaves another agent's wait alone", () => {
    register({ pubkey: WRITER });
    stallAgentStartWatches(SCOUT, "note");
    assert.equal(getAgentStartWatches(WELCOME)[0].phase, "starting");
  });
});

describe("hasAgentStartWatch", () => {
  it("is true while somebody waits on the agent, in any spelling, and false after", () => {
    assert.equal(hasAgentStartWatch(SCOUT), false);
    register();
    assert.equal(hasAgentStartWatch(SCOUT), true);
    assert.equal(hasAgentStartWatch(SCOUT.toUpperCase()), true);
    assert.equal(hasAgentStartWatch(WRITER), false);
    resolveAgentStartWatches(SCOUT);
    assert.equal(hasAgentStartWatch(SCOUT), false);
  });
});

describe("resolveAgentStartWatches with registeredBefore", () => {
  it("ends the waits registered before the moment and keeps the later ones", () => {
    register({ threadHeadId: null });
    mock.timers.tick(5_000);
    const cut = Date.now();
    mock.timers.tick(1);
    register({ threadHeadId: "thread-2", floorUnix: FLOOR_SECOND });
    resolveAgentStartWatches(SCOUT, { registeredBefore: cut });
    assert.deepEqual(
      getAgentStartWatches(WELCOME).map((watch) => watch.threadHeadId),
      ["thread-2"],
    );
  });

  it("keeps a wait registered in the very moment the look began", () => {
    register();
    resolveAgentStartWatches(SCOUT, { registeredBefore: Date.now() });
    assert.equal(hasAgentStartWatch(SCOUT), true);
  });

  it("without the option ends every wait for the agent, as before", () => {
    register();
    register({ threadHeadId: "thread-2" });
    resolveAgentStartWatches(SCOUT);
    assert.equal(hasAgentStartWatch(SCOUT), false);
  });
});
