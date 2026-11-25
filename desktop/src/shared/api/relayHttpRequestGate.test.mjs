import assert from "node:assert/strict";
import test from "node:test";

let fakeNow = 0;
let nextTimerId = 1;
const timers = new Map();

function setFakeTimeout(callback, delayMs) {
  const timer = nextTimerId++;
  timers.set(timer, { callback, at: fakeNow + delayMs });
  return timer;
}

function clearFakeTimeout(timer) {
  timers.delete(timer);
}

function tickTo(nextNow) {
  fakeNow = nextNow;
  for (;;) {
    const due = [...timers.entries()]
      .filter(([, timer]) => timer.at <= fakeNow)
      .sort(([, left], [, right]) => left.at - right.at)[0];
    if (!due) return;
    const [timer, scheduled] = due;
    timers.delete(timer);
    scheduled.callback();
  }
}

globalThis.window = {
  clearTimeout: clearFakeTimeout,
  setTimeout: setFakeTimeout,
};

const {
  RelayHttpRequestGate,
  _testSetRelayHttpRequestGate,
  fetchRelayHttp,
  isRelayHttpRateLimited,
  relayHttpRetryRemainingMs,
} = await import("./relayHttpRequestGate.ts");

const originalDateNow = Date.now;

function newGate({ budget = 240, interval = 250, windowMs = 60_000 } = {}) {
  return new RelayHttpRequestGate({
    budget,
    maxQueue: 300,
    requestIntervalMs: interval,
    scheduler: {
      clearTimeout: clearFakeTimeout,
      now: () => fakeNow,
      setTimeout: setFakeTimeout,
    },
    windowMs,
  });
}

function reset(options) {
  timers.clear();
  nextTimerId = 1;
  fakeNow = 0;
  Date.now = () => fakeNow;
  _testSetRelayHttpRequestGate(newGate(options));
}

test.after(() => {
  Date.now = originalDateNow;
});

test("HTTP gate spaces starts and never exceeds its fixed-window budget", async () => {
  reset({ budget: 3, interval: 1, windowMs: 10 });
  const started = [];
  const fetcher = async () => {
    started.push(fakeNow);
    return new Response(null, { status: 204 });
  };

  const requests = Array.from({ length: 4 }, () =>
    fetchRelayHttp("https://relay.test/query", { method: "POST" }, fetcher),
  );

  await Promise.resolve();
  assert.deepEqual(started, [0]);
  tickTo(1);
  await Promise.resolve();
  tickTo(2);
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);

  tickTo(9);
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);
  tickTo(10);
  await Promise.all(requests);
  assert.deepEqual(started, [0, 1, 2, 10]);
});

test("HTTP gate holds queued calls through a 429 retry window and then releases them", async () => {
  reset();
  const started = [];
  const refused = await fetchRelayHttp(
    "https://relay.test/query",
    { method: "POST" },
    async () => {
      started.push(fakeNow);
      return new Response(
        JSON.stringify({ error: "rate-limited: quota exceeded; retry in 32s" }),
        { status: 429 },
      );
    },
  );
  assert.equal(refused.status, 429);
  assert.equal(isRelayHttpRateLimited(), true);
  assert.equal(relayHttpRetryRemainingMs(), 32_000);

  const recovered = fetchRelayHttp(
    "https://relay.test/query",
    { method: "POST" },
    async () => {
      started.push(fakeNow);
      return new Response(null, { status: 204 });
    },
  );
  tickTo(31_999);
  await Promise.resolve();
  assert.deepEqual(started, [0]);
  assert.equal(isRelayHttpRateLimited(), true);

  tickTo(32_000);
  await recovered;
  assert.deepEqual(started, [0, 32_000]);
  assert.equal(isRelayHttpRateLimited(), false);
});

test("HTTP gate uses Retry-After when a 429 body has no retry hint", async () => {
  reset();
  await fetchRelayHttp(
    "https://relay.test/query",
    { method: "POST" },
    async () =>
      new Response(null, {
        headers: { "Retry-After": "17" },
        status: 429,
      }),
  );
  assert.equal(relayHttpRetryRemainingMs(), 17_000);
});
