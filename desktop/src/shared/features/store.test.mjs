import assert from "node:assert/strict";
import test from "node:test";

import { getOverrides, OVERRIDES_KEY, setOverride } from "./store.ts";

function installStorage(value) {
  const values = new Map([[OVERRIDES_KEY, JSON.stringify(value)]]);
  const writes = [];
  globalThis.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, next) => {
        writes.push([key, String(next)]);
        values.set(key, String(next));
      },
    },
  };
  return { values, writes };
}

test("getOverrides drops unknown feature IDs without writing to storage", () => {
  const { values, writes } = installStorage({
    agentManagedProfiles: true,
    removedFeature: false,
  });

  assert.deepEqual(getOverrides(), { agentManagedProfiles: true });
  assert.deepEqual(writes, []);
  assert.equal(
    values.get(OVERRIDES_KEY),
    JSON.stringify({ agentManagedProfiles: true, removedFeature: false }),
  );
});

test("setOverride persists filtered overrides", () => {
  const { values } = installStorage({
    removedFeature: false,
    workflows: true,
  });

  setOverride("agentManagedProfiles", true);

  assert.equal(
    values.get(OVERRIDES_KEY),
    JSON.stringify({ agentManagedProfiles: true }),
  );
});

test("getOverrides drops non-boolean values", () => {
  installStorage({ agentManagedProfiles: "yes", removedFeature: false });

  assert.deepEqual(getOverrides(), {});
});
