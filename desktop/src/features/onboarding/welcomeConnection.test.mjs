import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  DEVICE_VERIFIED_TTL_MS,
  readDeviceVerifiedRuntime,
  saveVerifiedWelcomeConnection,
  readVerifiedWelcomeConnection,
  readWelcomeBusinessContext,
} from "./welcomeConnection.ts";
const previous = globalThis.localStorage;
const previousWindow = globalThis.window;
const store = new Map();
globalThis.localStorage = {
  get length() {
    return store.size;
  },
  key: (index) => [...store.keys()][index] ?? null,
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, value),
  removeItem: (key) => store.delete(key),
};
globalThis.window = { localStorage: globalThis.localStorage };
afterEach(() => store.clear());
const config = {
  preferred_runtime: "claude",
  model: null,
  provider: null,
  env_vars: { ANTHROPIC_API_KEY: "test-only-placeholder" },
};
const proof = {
  reply: "I'm Scout. Welcome to Owner Company.",
  model: "sonnet",
  startupMs: 25,
  totalMs: 50,
};
test("real reply handoff is business and configuration scoped without persisting credentials", async () => {
  await saveVerifiedWelcomeConnection("business-a", config, proof);
  assert.equal(
    (await readVerifiedWelcomeConnection("business-a", config)).reply,
    proof.reply,
  );
  assert.equal(await readVerifiedWelcomeConnection("business-b", config), null);
  for (const change of [
    { preferred_runtime: "codex" },
    { model: "different" },
    { env_vars: {} },
    { env_vars: { ANTHROPIC_API_KEY: "replacement-test-placeholder" } },
  ]) {
    assert.equal(
      await readVerifiedWelcomeConnection("business-a", {
        ...config,
        ...change,
      }),
      null,
    );
  }
  assert.ok(
    ![...store.values()].some((value) =>
      value.includes("test-only-placeholder"),
    ),
  );
});
test("expired, malformed and empty evidence cannot waive readiness", async () => {
  await assert.rejects(
    saveVerifiedWelcomeConnection("a", config, { ...proof, reply: " " }),
  );
  await saveVerifiedWelcomeConnection("a", config, proof);
  const key = "colony-welcome-connection.v1:a";
  const saved = JSON.parse(store.get(key));
  store.set(
    key,
    JSON.stringify({ ...saved, completedAt: Date.now() - 15 * 60_000 }),
  );
  assert.equal(await readVerifiedWelcomeConnection("a", config), null);
  store.set(key, "broken JSON");
  assert.equal(await readVerifiedWelcomeConnection("a", config), null);
});
test("business context is selected by relay and retains all three supplied facts", () => {
  store.set(
    "buzz-communities",
    JSON.stringify([
      {
        id: "a",
        name: "Owner Company",
        relayUrl: "wss://company.example",
        businessCommunityId: "business-a",
      },
    ]),
  );
  const business = {
    name: "Owner Company",
    website: "https://example.com",
    description: "We deliver groceries.",
  };
  store.set("colony-business-profile.v1:business-a", JSON.stringify(business));
  assert.deepEqual(
    readWelcomeBusinessContext("wss://company.example/"),
    business,
  );
  assert.equal(readWelcomeBusinessContext("wss://other.example"), null);
});
process.on("exit", () => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
  if (previous === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = previous;
});

test("a route proved in one workspace is evidence for another on this Mac, without its reply", async () => {
  await saveVerifiedWelcomeConnection("business-a", config, proof);
  assert.equal(
    await readVerifiedWelcomeConnection("business-new", config),
    null,
  );
  assert.equal(await readDeviceVerifiedRuntime(config), "claude");
  // Only the runtime id comes back: the reply is business text.
  assert.equal(typeof (await readDeviceVerifiedRuntime(config)), "string");
});
test("device evidence is bound to the saved configuration and to 30 days", async () => {
  await saveVerifiedWelcomeConnection("business-a", config, proof);
  for (const change of [
    { preferred_runtime: "codex" },
    { model: "different" },
    { env_vars: {} },
  ]) {
    assert.equal(
      await readDeviceVerifiedRuntime({ ...config, ...change }),
      null,
    );
  }
  const key = "colony-welcome-connection.v1:business-a";
  const saved = JSON.parse(store.get(key));
  const completedAt = saved.completedAt;
  assert.equal(
    await readDeviceVerifiedRuntime(
      config,
      completedAt + DEVICE_VERIFIED_TTL_MS - 1,
    ),
    "claude",
  );
  assert.equal(
    await readDeviceVerifiedRuntime(
      config,
      completedAt + DEVICE_VERIFIED_TTL_MS,
    ),
    null,
  );
  assert.equal(await readDeviceVerifiedRuntime(config, completedAt - 1), null);
  store.set(key, "broken JSON");
  assert.equal(await readDeviceVerifiedRuntime(config), null);
  assert.equal(
    await readDeviceVerifiedRuntime({ ...config, preferred_runtime: null }),
    null,
  );
});
