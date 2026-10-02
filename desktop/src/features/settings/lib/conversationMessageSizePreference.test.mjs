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
      ["smaller", "0.8125"],
      ["default", "0.875"],
      ["larger", "0.9375"],
    ]) {
      applyConversationMessageSize(size);
      assert.equal(
        properties.get("--conversation-message-font-size"),
        `calc(var(--buzz-type-rem) * ${scale})`,
      );
    }
  } finally {
    delete globalThis.document;
  }
});
