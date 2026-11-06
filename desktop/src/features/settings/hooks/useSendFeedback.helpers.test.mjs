import assert from "node:assert/strict";
import test from "node:test";

import { ActionFailureError } from "@/shared/lib/actionFailure";
import {
  buildProductFeedbackEvent,
  submitProductFeedback,
} from "./useSendFeedback.ts";

test("buildProductFeedbackEvent uses body and category tag", () => {
  assert.deepEqual(
    buildProductFeedbackEvent({ category: "bug", message: "  It broke  " }, []),
    { content: "It broke", tags: [["category", "bug"]] },
  );
});

test("buildProductFeedbackEvent keeps category and imeta tags", () => {
  const attachment = {
    url: "https://example.test/screenshot.png",
    sha256: "ab".repeat(32),
    size: 42,
    type: "image/png",
    uploaded: 42,
  };
  const result = buildProductFeedbackEvent(
    { category: "suggestion", message: "Useful feedback" },
    [attachment],
  );
  assert.match(result.content, /Useful feedback/);
  assert.deepEqual(
    result.tags.find((tag) => tag[0] === "category"),
    ["category", "suggestion"],
  );
  assert.equal(
    result.tags.some((tag) => tag[0] === "imeta"),
    true,
  );
});

test("diagnostic upload preserves the native signing failure class", async () => {
  const previousWindow = globalThis.window;
  const commands = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command) => {
        commands.push(command);
        if (command === "upload_media_bytes") {
          throw "identity is in recovery mode; event signing is disabled";
        }
        throw new Error(`Unexpected native command: ${command}`);
      },
    },
  };

  try {
    await assert.rejects(
      submitProductFeedback(
        {
          category: "suggestion",
          includeLogs: true,
          message: "Testing Feedback",
        },
        null,
      ),
      (error) => {
        assert.ok(error instanceof ActionFailureError);
        assert.equal(error.actionFailure.failureClass, "signing");
        assert.equal(error.actionFailure.stage, "diagnostics-upload");
        assert.equal(error.actionFailure.code, "identity_recovery");
        return true;
      },
    );
    assert.ok(commands.includes("upload_media_bytes"));
    assert.equal(commands.includes("sign_event"), false);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("feedback event signing preserves a signing failure before relay publish", async () => {
  const previousWindow = globalThis.window;
  const commands = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command) => {
        commands.push(command);
        if (command === "sign_event") {
          throw "identity is in recovery mode; event signing is disabled";
        }
        throw new Error(`Unexpected native command: ${command}`);
      },
    },
  };

  try {
    await assert.rejects(
      submitProductFeedback(
        {
          category: "suggestion",
          includeLogs: false,
          message: "Testing Feedback",
        },
        null,
      ),
      (error) => {
        assert.ok(error instanceof ActionFailureError);
        assert.equal(error.actionFailure.failureClass, "signing");
        assert.equal(error.actionFailure.stage, "event-sign");
        return true;
      },
    );
    assert.deepEqual(commands, ["sign_event"]);
  } finally {
    globalThis.window = previousWindow;
  }
});
