import assert from "node:assert/strict";
import test from "node:test";

import { applyConversationMessageSize } from "./conversationMessageSizePreference.ts";

test("message size applies the reference type step to conversations only", () => {
  const properties = new Map();
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (key, value) => properties.set(key, value),
      },
    },
  };

  try {
    for (const [size, scale] of [
      ["smaller", "calc(var(--text-sm) - 1rem / 16)"],
      ["default", "var(--text-sm)"],
      ["larger", "calc(var(--text-sm) + 1rem / 16)"],
    ]) {
      applyConversationMessageSize(size);
      assert.equal(properties.get("--conversation-message-font-size"), scale);
    }
  } finally {
    delete globalThis.document;
  }
});
