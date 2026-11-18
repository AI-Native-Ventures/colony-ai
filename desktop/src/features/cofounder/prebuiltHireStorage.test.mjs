import assert from "node:assert/strict";
import test from "node:test";

import {
  clearPrebuiltHireProgress,
  readPrebuiltHireChoice,
  readPrebuiltHireCompletion,
  readPrebuiltHireProgress,
  writePrebuiltHireChoice,
  writePrebuiltHireCompletion,
  writePrebuiltHireProgress,
} from "./prebuiltHireStorage.ts";

function installStorage() {
  const values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    },
  });
}

test("prebuilt choices are local to one company and survive a later read", () => {
  installStorage();
  const choice = {
    runtimeId: "codex",
    providerId: "openai",
    modelId: "gpt-6",
    effortLevel: "high",
  };
  assert.equal(writePrebuiltHireChoice("company-a", choice), true);
  assert.deepEqual(readPrebuiltHireChoice("company-a"), choice);
  assert.equal(readPrebuiltHireChoice("company-b"), null);
});

test("unfinished hires preserve a retry record until the head finishes", () => {
  installStorage();
  const progress = {
    hireId: "hire-1",
    functionId: "finance",
    agentId: "finance-head",
    introductionChannelId: "channel-1",
    choice: {
      runtimeId: "codex",
      providerId: "openai",
      modelId: "gpt-6",
    },
    employeePubkey: "employee-1",
  };
  assert.equal(writePrebuiltHireProgress("company-a", progress), true);
  assert.deepEqual(readPrebuiltHireProgress("company-a", "finance"), progress);
  clearPrebuiltHireProgress("company-a", "finance");
  assert.equal(readPrebuiltHireProgress("company-a", "finance"), null);
});

test("a completed map hire keeps its direct chat only inside that company", () => {
  installStorage();
  const completion = {
    hireId: "hire-1",
    functionId: "finance",
    agentId: "prebuilt-head-finance",
    employeePubkey: "employee-1",
    directChannelId: "direct-1",
    firstMoveEventId: "message-1",
    firstMove: "Hi Basheer. Ask for the books.",
  };
  assert.equal(writePrebuiltHireCompletion("company-a", completion), true);
  assert.deepEqual(
    readPrebuiltHireCompletion("company-a", "finance"),
    completion,
  );
  assert.equal(readPrebuiltHireCompletion("company-b", "finance"), null);
});
