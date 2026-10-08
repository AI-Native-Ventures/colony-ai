import assert from "node:assert/strict";
import test from "node:test";

import { createBrowserProfileForgetter } from "./browserProfiles.ts";

const KEY = "colony-browser-forget-pending.v1";

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

function fakeHost({ failures = 0, failAll = false } = {}) {
  const calls = [];
  let remaining = failures;
  return {
    calls,
    async closeBusiness(businessId) {
      calls.push(["closeBusiness", businessId]);
      return { closedTabs: 0 };
    },
    async forgetBusiness(businessId) {
      calls.push(["forgetBusiness", businessId]);
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("Wait for browser downloads to stop");
      }
      return { forgottenProfiles: 1 };
    },
    async forgetAll() {
      calls.push(["forgetAll"]);
      if (failAll) throw new Error("host busy");
      return { forgottenProfiles: 2 };
    },
  };
}

function setup({ host, storage = memoryStorage() } = {}) {
  const delays = [];
  const forgetter = createBrowserProfileForgetter({
    host: () => host ?? null,
    storage: () => storage,
    delay: async (ms) => {
      delays.push(ms);
    },
  });
  return { forgetter, storage, delays };
}

const pendingOf = (storage) => JSON.parse(storage.items.get(KEY) ?? "null");

test("a removed community's tabs are closed, then its profile is forgotten", async (t) => {
  t.mock.method(console, "warn", () => {});
  const host = fakeHost();
  const { forgetter, storage } = setup({ host });
  assert.equal(await forgetter.forgetBusiness("community-a"), "forgotten");
  assert.deepEqual(host.calls, [
    ["closeBusiness", "community-a"],
    ["forgetBusiness", "community-a"],
  ]);
  assert.equal(storage.items.has(KEY), false);
});

test("a download that is still stopping is waited for, not given up on", async (t) => {
  t.mock.method(console, "warn", () => {});
  const host = fakeHost({ failures: 1 });
  const { forgetter, storage, delays } = setup({ host });
  assert.equal(await forgetter.forgetBusiness("community-a"), "forgotten");
  assert.equal(host.calls.filter(([op]) => op === "forgetBusiness").length, 2);
  assert.equal(delays.length, 1);
  assert.equal(storage.items.has(KEY), false);
});

test("a forget that keeps failing leaves a durable retry record and is retried later", async (t) => {
  t.mock.method(console, "warn", () => {});
  const stuck = fakeHost({ failures: 99 });
  const { forgetter, storage } = setup({ host: stuck });
  assert.equal(await forgetter.forgetBusiness("community-a"), "deferred");
  assert.deepEqual(pendingOf(storage), {
    all: false,
    businessIds: ["community-a"],
  });

  // The next start: the host works now, the record is honoured and cleared.
  const working = fakeHost();
  const next = setup({ host: working, storage });
  await next.forgetter.retryPending();
  assert.deepEqual(working.calls, [
    ["closeBusiness", "community-a"],
    ["forgetBusiness", "community-a"],
  ]);
  assert.equal(storage.items.has(KEY), false);
});

test("with no browser host the cleanup is recorded and waits for one", async (t) => {
  t.mock.method(console, "warn", () => {});
  const storage = memoryStorage();
  const none = setup({ host: null, storage });
  assert.equal(await none.forgetter.forgetBusiness("community-a"), "deferred");
  await none.forgetter.retryPending();
  assert.deepEqual(pendingOf(storage), {
    all: false,
    businessIds: ["community-a"],
  });

  const host = fakeHost();
  await setup({ host, storage }).forgetter.retryPending();
  assert.equal(storage.items.has(KEY), false);
  assert.deepEqual(host.calls.at(-1), ["forgetBusiness", "community-a"]);
});

test("sign out and account delete forget every profile once", async (t) => {
  t.mock.method(console, "warn", () => {});
  const host = fakeHost();
  const { forgetter, storage } = setup({
    host,
    storage: memoryStorage({
      [KEY]: JSON.stringify({ all: false, businessIds: ["old"] }),
    }),
  });
  assert.equal(await forgetter.forgetAll(), "forgotten");
  assert.deepEqual(host.calls, [["forgetAll"]]);
  assert.equal(storage.items.has(KEY), false);
});

test("a failed forget-all is recorded as forget everything", async (t) => {
  t.mock.method(console, "warn", () => {});
  const host = fakeHost({ failAll: true });
  const { forgetter, storage } = setup({ host });
  assert.equal(await forgetter.forgetAll(), "deferred");
  assert.deepEqual(pendingOf(storage), { all: true, businessIds: [] });

  const working = fakeHost();
  await setup({ host: working, storage }).forgetter.retryPending();
  assert.deepEqual(working.calls, [["forgetAll"]]);
  assert.equal(storage.items.has(KEY), false);
});

test("the retry record is bounded: too many communities collapse to forget everything", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { forgetter, storage } = setup({ host: null });
  for (let index = 0; index < 70; index += 1)
    await forgetter.forgetBusiness(`community-${index}`);
  assert.deepEqual(pendingOf(storage), { all: true, businessIds: [] });
});

test("a damaged retry record is ignored, not trusted", async (t) => {
  t.mock.method(console, "warn", () => {});
  const host = fakeHost();
  const storage = memoryStorage({ [KEY]: "{not json" });
  await setup({ host, storage }).forgetter.retryPending();
  assert.deepEqual(host.calls, []);
  const hostile = memoryStorage({
    [KEY]: JSON.stringify({ all: "yes", businessIds: [1, null, "ok", "ok"] }),
  });
  const other = fakeHost();
  await setup({ host: other, storage: hostile }).forgetter.retryPending();
  assert.deepEqual(other.calls, [
    ["closeBusiness", "ok"],
    ["forgetBusiness", "ok"],
  ]);
});

test("a retry that is already running is not started twice", async (t) => {
  t.mock.method(console, "warn", () => {});
  const host = fakeHost();
  const storage = memoryStorage({
    [KEY]: JSON.stringify({ all: false, businessIds: ["community-a"] }),
  });
  const { forgetter } = setup({ host, storage });
  await Promise.all([forgetter.retryPending(), forgetter.retryPending()]);
  assert.equal(host.calls.filter(([op]) => op === "forgetBusiness").length, 1);
});
