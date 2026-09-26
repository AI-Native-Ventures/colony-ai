import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteFactoryPlan,
  factoryPlanStorageKey,
  loadFactoryPlans,
  saveFactoryPlan,
} from "./factoryPlanStore.ts";

const scope = {
  relayUrl: "wss://relay.example",
  identityPubkey: "pubkey-a",
  businessCommunityId: "business-a",
  clientChannelId: "client-a",
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("Factory plans persist under the complete business and client scope", () => {
  const storage = memoryStorage();
  const plan = { id: "plan-a", title: "Portal", status: "draft" };
  saveFactoryPlan(storage, scope, plan);

  assert.deepEqual(loadFactoryPlans(storage, scope), [plan]);
  assert.deepEqual(
    loadFactoryPlans(storage, { ...scope, clientChannelId: "client-b" }),
    [],
  );
  assert.notEqual(
    factoryPlanStorageKey(scope),
    factoryPlanStorageKey({ ...scope, businessCommunityId: "business-b" }),
  );
});

test("plan writes propagate storage failures instead of reporting a save", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };

  assert.throws(
    () => saveFactoryPlan(storage, scope, { id: "plan-a" }),
    /quota exceeded/,
  );
});

test("deleting one plan preserves the other scoped records", () => {
  const storage = memoryStorage();
  saveFactoryPlan(storage, scope, { id: "plan-a" });
  saveFactoryPlan(storage, scope, { id: "plan-b" });

  assert.deepEqual(
    deleteFactoryPlan(storage, scope, "plan-a").map((plan) => plan.id),
    ["plan-b"],
  );
});
