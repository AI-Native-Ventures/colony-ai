import assert from "node:assert/strict";
import test from "node:test";
import { ensureOnboardingProfile } from "./onboardingProfile.ts";
const key = "colony-signup-name.v1:owner@example.com";
function setup({ existing = false, name = "Amina", failure = false } = {}) {
  const values = new Map([[key, name]]);
  const writes = [];
  const deps = {
    read: async () => ({ pubkey: "identity", hasProfileEvent: existing }),
    account: async () => ({ pubkey: "identity", email: "owner@example.com" }),
    write: async (input) => {
      writes.push(input);
      if (failure) throw new Error("offline");
      return input;
    },
    storage: {
      getItem: (k) => values.get(k),
      removeItem: (k) => values.delete(k),
    },
  };
  return { values, writes, deps };
}
test("first entry publishes the signup name through the production kind:0 seam", async () => {
  const s = setup();
  await ensureOnboardingProfile(() => true, s.deps);
  assert.deepEqual(s.writes, [{ displayName: "Amina" }]);
  assert.equal(s.values.has(key), false);
});
test("missing name falls back to email local part", async () => {
  const s = setup({ name: "" });
  await ensureOnboardingProfile(() => true, s.deps);
  assert.deepEqual(s.writes, [{ displayName: "owner" }]);
});
test("an existing profile is preserved", async () => {
  const s = setup({ existing: true });
  await ensureOnboardingProfile(() => true, s.deps);
  assert.equal(s.writes.length, 0);
});
test("failed publication retains the durable name for retry", async () => {
  const s = setup({ failure: true });
  await assert.rejects(
    ensureOnboardingProfile(() => true, s.deps),
    /offline/,
  );
  assert.equal(s.values.get(key), "Amina");
});
test("cancelled lookup never publishes a profile", async () => {
  const s = setup();
  await assert.rejects(
    ensureOnboardingProfile(() => false, s.deps),
    /cancelled/,
  );
  assert.equal(s.writes.length, 0);
});
