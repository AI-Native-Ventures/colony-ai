import assert from "node:assert/strict";
import { test } from "node:test";

import { bindNativeView } from "./browserNativeView.ts";

function harness({
  rect = { left: 10, top: 20, width: 300, height: 200 },
  visible = true,
} = {}) {
  const calls = [];
  const frames = [];
  let time = 0;
  let covered = false;
  let failAttach = false;
  const failures = [];
  const element = { getBoundingClientRect: () => ({ ...rect }) };
  const host = {
    async attach(id, bounds, shown) {
      calls.push(["attach", id, { ...bounds }, shown]);
      if (failAttach)
        throw new Error("Browser bounds must fit within the app window");
      return {};
    },
    async detach(id) {
      calls.push(["detach", id]);
      return {};
    },
  };
  const stop = bindNativeView("tab-1", {
    host,
    element,
    visible,
    covered: () => covered,
    schedule: (callback) => frames.push(callback),
    cancel: () => {},
    clock: () => time,
    onFailure: (message) => failures.push(message),
  });
  return {
    calls,
    rect,
    failures,
    stop,
    setCovered: (value) => {
      covered = value;
    },
    setFail: (value) => {
      failAttach = value;
    },
    advance: (ms) => {
      time += ms;
    },
    async frame(count = 1) {
      for (let index = 0; index < count; index += 1) {
        const next = frames.shift();
        next?.();
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

test("attaches at the slot's box and follows it when it moves or resizes", async () => {
  const h = harness();
  await h.frame();
  assert.deepEqual(h.calls.at(-1), [
    "attach",
    "tab-1",
    { x: 10, y: 20, width: 300, height: 200 },
    true,
  ]);
  await h.frame(2);
  assert.equal(h.calls.length, 1, "an unchanged box sends nothing");
  h.rect.left = 40;
  h.rect.width = 250.4;
  await h.frame(2);
  assert.deepEqual(h.calls.at(-1)[2], {
    x: 40,
    y: 20,
    width: 250,
    height: 200,
  });
});

test("an open menu or dialog, or a zero-size slot, takes the page away", async () => {
  const h = harness();
  await h.frame();
  h.setCovered(true);
  await h.frame(2);
  assert.deepEqual(h.calls.at(-1), ["detach", "tab-1"]);
  h.setCovered(false);
  await h.frame(2);
  assert.equal(h.calls.at(-1)[0], "attach");
  h.rect.width = 0;
  await h.frame(2);
  assert.deepEqual(h.calls.at(-1), ["detach", "tab-1"]);
});

test("a tab that is not on screen is never attached", async () => {
  const h = harness({ visible: false });
  await h.frame(3);
  assert.deepEqual(
    h.calls.filter((call) => call[0] === "attach"),
    [],
  );
});

test("unbinding detaches the page", async () => {
  const h = harness();
  await h.frame();
  h.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.calls.at(-1), ["detach", "tab-1"]);
});

test("a host that keeps refusing is retried with backoff, then reported once and stopped", async () => {
  const h = harness();
  h.setFail(true);
  for (let index = 0; index < 30; index += 1) {
    await h.frame();
    h.advance(5_000);
  }
  const attaches = h.calls.filter((call) => call[0] === "attach").length;
  assert.equal(attaches, 5, "five tries, not one per frame");
  assert.equal(h.failures.length, 1);
  assert.match(h.failures[0], /bounds/u);
});

test("backoff spaces retries instead of hammering the host every frame", async () => {
  const h = harness();
  h.setFail(true);
  await h.frame(10);
  assert.equal(h.calls.filter((call) => call[0] === "attach").length, 1);
  h.advance(300);
  await h.frame(3);
  assert.equal(h.calls.filter((call) => call[0] === "attach").length, 2);
});
