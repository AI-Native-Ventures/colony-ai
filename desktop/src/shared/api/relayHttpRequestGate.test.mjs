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

function newGate({
  budget = 240,
  burstAllowance = 30,
  windowMs = 60_000,
} = {}) {
  return new RelayHttpRequestGate({
    budget,
    burstAllowance,
    maxQueue: 300,
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

test("HTTP gate admits a bounded burst and never exceeds its rolling budget", async () => {
  reset({ budget: 6, burstAllowance: 3, windowMs: 60 });
  const started = [];
  const fetcher = async () => {
    started.push(fakeNow);
    return new Response(null, { status: 204 });
  };

  const requests = Array.from({ length: 7 }, () =>
    fetchRelayHttp("https://relay.test/query", { method: "POST" }, fetcher),
  );

  await Promise.resolve();
  assert.deepEqual(started, [0, 0, 0]);
  tickTo(10);
  await Promise.resolve();
  assert.deepEqual(started, [0, 0, 0, 10]);
  tickTo(20);
  await Promise.resolve();
  assert.deepEqual(started, [0, 0, 0, 10, 20]);
  tickTo(30);
  await Promise.resolve();
  assert.deepEqual(started, [0, 0, 0, 10, 20, 30]);

  tickTo(59);
  await Promise.resolve();
  assert.deepEqual(started, [0, 0, 0, 10, 20, 30]);
  tickTo(60);
  await Promise.all(requests);
  assert.deepEqual(started, [0, 0, 0, 10, 20, 30, 60]);
});

test("synthetic E2E transport bypasses the HTTP gate unless the bridge opts in", async () => {
  reset({ budget: 1, burstAllowance: 1, windowMs: 100 });
  window.__BUZZ_E2E_USES_REAL_RELAY__ = false;
  window.__BUZZ_E2E_FORCE_RELAY_PACING__ = false;
  const started = [];
  const fetcher = async () => {
    started.push(fakeNow);
    return new Response(null, { status: 204 });
  };

  await Promise.all(
    Array.from({ length: 3 }, () =>
      fetchRelayHttp("https://relay.test/query", { method: "POST" }, fetcher),
    ),
  );
  assert.deepEqual(started, [0, 0, 0]);

  window.__BUZZ_E2E_FORCE_RELAY_PACING__ = true;
  const paced = Array.from({ length: 2 }, () =>
    fetchRelayHttp("https://relay.test/query", { method: "POST" }, fetcher),
  );
  await Promise.resolve();
  assert.deepEqual(started, [0, 0, 0, 0]);
  tickTo(100);
  await Promise.all(paced);
  assert.deepEqual(started, [0, 0, 0, 0, 100]);

  delete window.__BUZZ_E2E_USES_REAL_RELAY__;
  delete window.__BUZZ_E2E_FORCE_RELAY_PACING__;
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
