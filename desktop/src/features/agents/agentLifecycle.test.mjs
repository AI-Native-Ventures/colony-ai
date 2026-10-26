import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
  isAgentLifecycleBusy,
  MAX_HOLD_MS,
  resetAgentLifecycle,
  runAgentLifecycle,
  trackAgentStart,
} from "./agentLifecycle.ts";

const SCOUT =
  "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
const NOVA = "dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321dcba4321";

const settle = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

/** A promise the test settles by hand. */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

afterEach(() => {
  mock.timers.reset();
  resetAgentLifecycle();
});

describe("runAgentLifecycle", () => {
  it("runs operations on one agent one after another, in the order asked", async () => {
    const steps = [];
    const first = gate();
    const a = runAgentLifecycle(SCOUT, "send start", async () => {
      steps.push("send start: begin");
      await first.promise;
      steps.push("send start: end");
    });
    const b = runAgentLifecycle(SCOUT, "reconcile", async () => {
      steps.push("reconcile: stop");
      steps.push("reconcile: start");
    });
    await settle();
    // The reconcile has not touched the agent: the start is still in flight.
    assert.deepEqual(steps, ["send start: begin"]);
    first.open();
    await Promise.all([a, b]);
    assert.deepEqual(steps, [
      "send start: begin",
      "send start: end",
      "reconcile: stop",
      "reconcile: start",
    ]);
  });

  it("does not make different agents wait for each other", async () => {
    const held = gate();
    const slow = runAgentLifecycle(SCOUT, "slow", () => held.promise);
    let ran = false;
    await runAgentLifecycle(NOVA, "other", async () => {
      ran = true;
    });
    assert.equal(ran, true);
    held.open();
    await slow;
  });

  it("treats the same agent in any spelling as one agent", async () => {
    const held = gate();
    const first = runAgentLifecycle(SCOUT, "first", () => held.promise);
    let ran = false;
    const second = runAgentLifecycle(
      SCOUT.toUpperCase(),
      "second",
      async () => {
        ran = true;
      },
    );
    await settle();
    assert.equal(ran, false);
    held.open();
    await Promise.all([first, second]);
    assert.equal(ran, true);
  });

  it("hands back each operation's own result and failure", async () => {
    assert.equal(await runAgentLifecycle(SCOUT, "ok", async () => 7), 7);
    await assert.rejects(
      runAgentLifecycle(SCOUT, "bad", async () => {
        throw new Error("spawn failed");
      }),
      /spawn failed/,
    );
  });

  it("lets the next operation run after one fails", async () => {
    const failing = runAgentLifecycle(SCOUT, "bad", async () => {
      throw new Error("spawn failed");
    });
    const after = runAgentLifecycle(SCOUT, "after", async () => "ran");
    await assert.rejects(failing, /spawn failed/);
    assert.equal(await after, "ran");
  });

  it("is busy while an operation runs or waits, and idle afterwards", async () => {
    assert.equal(isAgentLifecycleBusy(SCOUT), false);
    const held = gate();
    const running = runAgentLifecycle(SCOUT, "start", () => held.promise);
    assert.equal(isAgentLifecycleBusy(SCOUT), true);
    assert.equal(isAgentLifecycleBusy(NOVA), false);
    held.open();
    await running;
    await settle();
    assert.equal(isAgentLifecycleBusy(SCOUT), false);
  });

  it("never lets a hung operation freeze the agent for good", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const warn = mock.method(console, "warn", () => {});
    const hung = new Promise(() => {});
    void runAgentLifecycle(SCOUT, "hung start", () => hung);
    let ran = false;
    const next = runAgentLifecycle(SCOUT, "reconcile", async () => {
      ran = true;
    });
    await settle();
    assert.equal(ran, false);
    mock.timers.tick(MAX_HOLD_MS);
    await next;
    assert.equal(ran, true);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0].arguments[0]), /hung start/);
    warn.mock.restore();
  });
});

describe("trackAgentStart", () => {
  it("makes a queued operation wait for a start a send fired, which itself waited for nobody", async () => {
    const start = gate();
    trackAgentStart(SCOUT, start.promise);
    assert.equal(isAgentLifecycleBusy(SCOUT), true);
    let ran = false;
    const queued = runAgentLifecycle(SCOUT, "reconcile", async () => {
      ran = true;
    });
    await settle();
    assert.equal(ran, false, "the reconcile waits for the start to land");
    start.open();
    await queued;
    assert.equal(ran, true);
    await settle();
    assert.equal(isAgentLifecycleBusy(SCOUT), false);
  });

  it("does not hold the queue up when the start fails", async () => {
    trackAgentStart(SCOUT, Promise.reject(new Error("spawn failed")));
    assert.equal(
      await runAgentLifecycle(SCOUT, "after", async () => "ran"),
      "ran",
    );
  });

  it("waits for every start in flight for the agent", async () => {
    const first = gate();
    const second = gate();
    trackAgentStart(SCOUT, first.promise);
    trackAgentStart(SCOUT, second.promise);
    let ran = false;
    const queued = runAgentLifecycle(SCOUT, "reconcile", async () => {
      ran = true;
    });
    first.open();
    await settle();
    assert.equal(ran, false);
    second.open();
    await queued;
    assert.equal(ran, true);
  });

  it("goes ahead after the hold limit when a start hangs", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const warn = mock.method(console, "warn", () => {});
    trackAgentStart(SCOUT, new Promise(() => {}));
    let ran = false;
    const queued = runAgentLifecycle(SCOUT, "reconcile", async () => {
      ran = true;
    });
    await settle();
    mock.timers.tick(MAX_HOLD_MS);
    await queued;
    assert.equal(ran, true);
    assert.equal(warn.mock.callCount(), 1);
    warn.mock.restore();
  });
});
