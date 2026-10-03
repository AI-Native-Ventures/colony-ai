import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError } from "../auth/authApi.ts";
import { startAccountClaimLookup } from "./accountClaimLookup.ts";
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("network failures retry with bounded backoff, then focus can recover eligibility", async () => {
  const scheduled = [];
  const delays = [];
  let calls = 0;
  let recovered = false;
  let eligible = false;
  const lookup = startAccountClaimLookup({
    read: async () => {
      calls++;
      if (!recovered) throw new AuthApiError("network_error");
      return null;
    },
    onAccount: (account) => {
      eligible = account === null;
    },
    onFailure: (code, contract) => {
      assert.equal(code, "network_error");
      assert.equal(contract, false);
    },
    schedule: (callback, delay) => {
      scheduled.push(callback);
      delays.push(delay);
      return scheduled.length;
    },
    clear: () => {},
  });
  await settle();
  while (scheduled.length) {
    scheduled.shift()();
    await settle();
  }
  assert.deepEqual(delays, [1000, 4000, 10000]);
  assert.equal(calls, 4);
  recovered = true;
  lookup.retryOnFocus();
  await settle();
  assert.equal(calls, 5);
  assert.equal(eligible, true);
  lookup.cancel();
});

test("contract and identity failures stay distinct and cannot enter automatic retry loops", async () => {
  for (const code of [
    "invalid_response",
    "identity_changed",
    "identity_unavailable",
  ]) {
    let recorded;
    const lookup = startAccountClaimLookup({
      read: async () => {
        throw new AuthApiError(code);
      },
      onAccount: () => assert.fail(),
      onFailure: (failure, contract) => {
        recorded = [failure, contract];
      },
      schedule: () => assert.fail("contract failures do not silently retry"),
    });
    await settle();
    assert.deepEqual(recorded, [code, true]);
    lookup.cancel();
  }
});

test("cancellation fences pending account reads and clears a scheduled retry", async () => {
  let resolve;
  const pending = startAccountClaimLookup({
    read: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onAccount: () => assert.fail("stale result"),
    onFailure: () => assert.fail(),
  });
  pending.cancel();
  resolve(null);
  await settle();
  let cleared;
  const lookup = startAccountClaimLookup({
    read: async () => {
      throw new AuthApiError("network_error");
    },
    onAccount: () => assert.fail(),
    onFailure: () => {},
    schedule: () => 17,
    clear: (timer) => {
      cleared = timer;
    },
  });
  await settle();
  lookup.cancel();
  assert.equal(cleared, 17);
});
