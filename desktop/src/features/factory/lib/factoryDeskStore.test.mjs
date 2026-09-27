import assert from "node:assert/strict";
import test from "node:test";

import {
  assignRunToFactoryTab,
  factoryDeskStorageKey,
  loadFactoryDesk,
  saveFactoryDesk,
} from "./factoryDeskStore.ts";

const scope = {
  relayUrl: "wss://relay.example",
  identityPubkey: "pubkey-a",
  businessCommunityId: "business-a",
  clientChannelId: null,
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("desk tabs and run assignments survive reload in the full scope", () => {
  const storage = memoryStorage();
  const original = loadFactoryDesk(storage, scope);
  const next = assignRunToFactoryTab(
    {
      ...original,
      tabs: [...original.tabs, { id: "tab-2", name: "Portal team" }],
    },
    "run-1",
    "tab-2",
  );
  saveFactoryDesk(storage, scope, next);

  assert.deepEqual(loadFactoryDesk(storage, scope), next);
  assert.notEqual(
    factoryDeskStorageKey(scope),
    factoryDeskStorageKey({ ...scope, clientChannelId: "client-b" }),
  );
});

test("saving desk state propagates storage failures", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("storage is unavailable");
    },
  };

  assert.throws(
    () => saveFactoryDesk(storage, scope, loadFactoryDesk(storage, scope)),
    /storage is unavailable/,
  );
});
