import assert from "node:assert/strict";
import test from "node:test";

import {
  readCompanyRoleDraft,
  removeCompanyRoleDraft,
  resetCompanyRoleDraftStore,
  writeCompanyRoleDraft,
} from "./companyRoleDraftStore.ts";

function withSessionStorage(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => value,
  });
  try {
    run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "sessionStorage", descriptor);
    } else {
      delete globalThis.sessionStorage;
    }
    resetCompanyRoleDraftStore();
  }
}

const roleDraft = {
  displayName: "Research assistant",
  roleDraft: {
    job: "Research hospitality accounts.",
    skills: "Research\nSynthesis",
    tools: [{ id: "tool-1", name: "Read approved files", risk: "low" }],
    workerMenu: ["goose"],
  },
};

test("role draft remains available when session storage cannot be read", () => {
  withSessionStorage(undefined, () => {
    assert.equal(writeCompanyRoleDraft("relay-a", "new", roleDraft), false);
    assert.deepEqual(readCompanyRoleDraft("relay-a", "new"), roleDraft);
  });
});

test("clearing a role draft hides stale storage when remove fails", () => {
  let storedValue = null;
  withSessionStorage(
    {
      getItem: () => storedValue,
      setItem: (_key, value) => {
        storedValue = value;
      },
      removeItem: () => {
        throw new Error("storage is unavailable");
      },
    },
    () => {
      assert.equal(writeCompanyRoleDraft("relay-b", "new", roleDraft), true);
      removeCompanyRoleDraft("relay-b", "new");
      assert.equal(readCompanyRoleDraft("relay-b", "new"), null);
    },
  );
});
